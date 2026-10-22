import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { ApiStatsService } from "../common/api-stats.service.js";
import { DB, type Db } from "../db/db.module.js";

const TZ = "Europe/Istanbul";
const WEEKS = 8;
const DAYS = 14;
/** Oran metriklerinin penceresi (gün) */
const WINDOW_DAYS = 30;

const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

/**
 * Y5 / FR-53 platform metrikleri (docs/03 §8). Günler ve haftalar Türkiye saatine göre; hafta pazartesi başlar.
 * - Haftalık kapanan yük: "tamamlandı"ya geçen iş (ana başarı ölçütü), tamamlanma zamanına göre.
 * - İlan tazeliği: yayındaki ilanların son 24 saatte teyit edilen oranı.
 * - Teyit cevabı: son 30 günde sorulan sorular; cevap oranı = cevaplanan / (cevaplanan + cevapsız düşen), açık sorular hariç.
 * - Eşleşme isabeti: son 30 günde bildirilen eşleşmelerden teklife ya da aramaya dönüşen oran.
 */
@Injectable()
export class MetricsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly apiStats: ApiStatsService,
  ) {}

  async metrics() {
    const weekly = await this.db.execute<{ week: string; closed: number }>(sql`
      with weeks as (
        select generate_series(
          date_trunc('week', now() at time zone ${TZ}) - make_interval(weeks => ${WEEKS - 1}),
          date_trunc('week', now() at time zone ${TZ}),
          interval '1 week'
        ) as week
      )
      select to_char(w.week, 'YYYY-MM-DD') as week, count(j.id)::int as closed
      from weeks w
      left join jobs j on j.status = 'tamamlandi'
        and date_trunc('week', j.completed_at at time zone ${TZ}) = w.week
      group by w.week order by w.week
    `);

    const daily = await this.db.execute<{ day: string; loads: number }>(sql`
      with days as (
        select generate_series((now() at time zone ${TZ})::date - ${DAYS - 1}::int, (now() at time zone ${TZ})::date, interval '1 day')::date as day
      )
      select to_char(d.day, 'YYYY-MM-DD') as day, count(l.id)::int as loads
      from days d
      left join load_posts l on (l.created_at at time zone ${TZ})::date = d.day
      group by d.day order by d.day
    `);

    const [live] = (
      await this.db.execute<{ visible: number; fresh: number }>(sql`
        select count(*)::int as visible,
               count(*) filter (where last_confirmed_at > now() - interval '24 hours')::int as fresh
        from load_posts where status in ('teyitli', 'teyit_bekliyor')
      `)
    ).rows;

    const [conf] = (
      await this.db.execute<{ asked: number; answered: number; unanswered: number; open: number; median_min: number | null }>(sql`
        select count(*)::int as asked,
               count(*) filter (where answer in ('gecerli', 'arac_bulundu', 'iptal'))::int as answered,
               count(*) filter (where answer = 'cevapsiz')::int as unanswered,
               count(*) filter (where answer is null)::int as open,
               (percentile_cont(0.5) within group (order by extract(epoch from answered_at - asked_at) / 60)
                  filter (where answer in ('gecerli', 'arac_bulundu', 'iptal')))::float as median_min
        from load_confirmations where asked_at > now() - make_interval(days => ${WINDOW_DAYS})
      `)
    ).rows;

    const [match] = (
      await this.db.execute<{ created: number; notified: number; converted: number }>(sql`
        select count(*)::int as created,
               count(*) filter (where notified_at is not null)::int as notified,
               count(*) filter (where notified_at is not null and outcome in ('teklif', 'arandi'))::int as converted
        from matches where created_at > now() - make_interval(days => ${WINDOW_DAYS})
      `)
    ).rows;

    // NFR-09 bildirim teslimi: gerçek push (FCM) yokken teslim ölçülemez; uygulama içi bildirimin okunma oranı vekil ölçüt
    const [notif] = (
      await this.db.execute<{ created: number; read: number }>(sql`
        select count(*)::int as created, count(read_at)::int as read from notifications where created_at >= now() - make_interval(days => ${WINDOW_DAYS})
      `)
    ).rows;
    return {
      api: { last24h: await this.apiStats.summary(24), last7d: await this.apiStats.summary(24 * 7) },
      notifications: { windowDays: WINDOW_DAYS, created: notif!.created, read: notif!.read, readRate: ratio(notif!.read, notif!.created) },
      weeklyClosed: weekly.rows,
      dailyLoads: daily.rows,
      live: { visible: live!.visible, fresh: live!.fresh, freshness: ratio(live!.fresh, live!.visible) },
      confirmations: {
        windowDays: WINDOW_DAYS,
        asked: conf!.asked,
        answered: conf!.answered,
        unanswered: conf!.unanswered,
        open: conf!.open,
        answerRate: ratio(conf!.answered, conf!.answered + conf!.unanswered),
        medianMinutes: conf!.median_min === null ? null : Math.round(conf!.median_min),
      },
      matches: {
        windowDays: WINDOW_DAYS,
        created: match!.created,
        notified: match!.notified,
        converted: match!.converted,
        hitRate: ratio(match!.converted, match!.notified),
      },
    };
  }
}
