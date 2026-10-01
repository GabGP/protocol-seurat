package seurat.core.viewing.loans;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.Predicate;
import seurat.core.shared.proto.Ranges;
import seurat.core.shared.proto.msg.MsgLoans;

/**
 * Server orders of one canvas (spec 3.3): one `orden` counter shared by RASPAR,
 * RENOVAR and AUDITAR, and what each still waits for. Guarded by the canvas lock.
 */
public final class CanvasOrders {
    /** A RASPAR awaiting its RASPADO; then runs after its confirmation (withdrawal: ERROR 4). */
    public record ScrapeOrder(long order, long through, long epoch, Predicate<Delivery> scrape,
            Ranges cancelled, long deadlineNs, Runnable then, MsgLoans.Scrape wire) {}

    public record AuditOrder(long order, long through) {}

    private long last;
    private final TreeMap<Long, ScrapeOrder> scrapes = new TreeMap<>();
    private final Map<Long, Ranges> renewals = new HashMap<>();
    private final Map<Long, AuditOrder> audits = new HashMap<>();

    public long next() {
        return ++last;
    }

    public boolean issued(long order) {
        return order >= 1 && order <= last;
    }

    public void addScrape(ScrapeOrder order) {
        scrapes.put(order.order(), order);
    }

    public ScrapeOrder scrape(long order) {
        return scrapes.get(order);
    }

    /** RASPADO of order k implies every earlier pending order was applied too (spec 4.2.5). */
    public List<ScrapeOrder> scrapesThrough(long order) {
        return new ArrayList<>(scrapes.headMap(order, true).values());
    }

    public List<ScrapeOrder> pendingScrapes() {
        return List.copyOf(scrapes.values());
    }

    public void resolveThrough(long order) {
        scrapes.headMap(order, true).clear();
    }

    public void addRenewal(long order, Ranges ranges) {
        renewals.put(order, ranges);
    }

    /** RENOVAR the client has not acknowledged yet (renov_hasta below their orden). */
    public List<Ranges> pendingRenewals() {
        return List.copyOf(renewals.values());
    }

    /** renov_hasta: every RENOVAR up to it was applied; hands back their ranges once. */
    public List<Ranges> takeRenewalsThrough(long order) {
        List<Ranges> out = new ArrayList<>();
        renewals.entrySet().removeIf(e -> {
            if (e.getKey() > order) {
                return false;
            }
            out.add(e.getValue());
            return true;
        });
        return out;
    }

    public void addAudit(AuditOrder audit) {
        audits.put(audit.order(), audit);
    }

    public AuditOrder takeAudit(long order) {
        return audits.remove(order);
    }

    /**
     * Resume: the new connection never saw the old AUDITAR/RENOVAR; pending RASPAR are
     * sent again (same orden and N) with a fresh deadline. Returns what to resend.
     */
    public List<MsgLoans.Scrape> reissue(long deadlineNs) {
        audits.clear();
        renewals.clear();
        List<MsgLoans.Scrape> out = new ArrayList<>();
        scrapes.replaceAll((k, o) -> {
            out.add(o.wire());
            return new ScrapeOrder(o.order(), o.through(), o.epoch(), o.scrape(), o.cancelled(),
                    deadlineNs, o.then(), o.wire());
        });
        return out;
    }
}
