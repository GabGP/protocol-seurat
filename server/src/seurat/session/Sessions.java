package seurat.session;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import seurat.config.SeuratConstants;
import seurat.config.Units;

/**
 * Session registry: live sessions, single-use tokens, and resumable books (spec 8).
 * A dead session's canvases stay adoptable L + delta under its (id, ticket). After
 * an adoption the key keeps pointing at the adopter until its first RECIBO, so a
 * retry after a lost BIENVENIDA yields the same result (idempotent resume).
 */
public final class Sessions {
    private final AtomicLong next = new AtomicLong(1);
    private final Map<Long, Session> live = new ConcurrentHashMap<>();
    private final Map<String, Token> tokens = new ConcurrentHashMap<>();
    private final Map<Long, Resumable> resumable = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    public record Token(String principal, String role, long memMib, long expiresNs) {}

    /** The books adoptable under a previous session id; holder = whoever holds the canvases now. */
    public record Resumable(byte[] ticket, String principal, Session holder, long expiresNs) {}

    public long reserveId() {
        return next.getAndIncrement();
    }

    public byte[] newTicket() {
        byte[] f = new byte[SeuratConstants.TOKEN_BYTES];
        random.nextBytes(f);
        return f;
    }

    public String issueToken(String principal, String role, long memMib, long ttlMs) {
        byte[] t = new byte[SeuratConstants.TOKEN_BYTES];
        random.nextBytes(t);
        String hex = HexFormat.of().formatHex(t);
        long now = System.nanoTime();
        tokens.values().removeIf(old -> old.expiresNs() < now); // unused tokens do not pile up
        tokens.put(hex, new Token(principal, role, memMib, now + ttlMs * Units.NANOS_PER_MS));
        return hex;
    }

    public Token consumeToken(String hex) {
        Token t = tokens.remove(hex);
        return t == null || t.expiresNs() < System.nanoTime() ? null : t;
    }

    public void add(Session session) {
        live.put(session.id(), session);
    }

    public Session find(long id) {
        return live.get(id);
    }

    public Collection<Session> all() {
        return live.values();
    }

    /** L + delta: how long a dead session's books outlive it (spec 8). */
    private static long bookLifeNs(Session session) {
        return SeuratConstants.LEASE_S * Units.NANOS_PER_S + session.roundTrip.deltaNs();
    }

    /** Disconnect: its books live L + delta; unacked deliveries and renewals expire with them (spec 8). */
    public void retire(Session session) {
        live.remove(session.id());
        long deadline = System.nanoTime() + bookLifeNs(session);
        for (Canvas c : session.canvases().values()) {
            synchronized (c) {
                c.book().expireUnacked(deadline);
                c.orders().pendingRenewals().forEach(r -> c.book().expireRenewed(r, deadline));
            }
        }
        resumable.put(session.id(), new Resumable(session.ticket(), session.principal(), session, deadline));
        resumable.replaceAll((id, r) -> r.holder() == session
                ? new Resumable(r.ticket(), r.principal(), session, deadline) : r);
    }

    /** Valid (id, ticket, principal) -> who holds the books now; null otherwise. */
    public Resumable resumable(long previous, byte[] ticket, String principal) {
        Resumable r = resumable.get(previous);
        if (r == null || r.expiresNs() < System.nanoTime()
                || !Arrays.equals(r.ticket(), ticket) || !r.principal().equals(principal)) {
            return null;
        }
        return r;
    }

    public void adopted(long previous, Resumable r, Session adopter) {
        resumable.put(previous, new Resumable(r.ticket(), r.principal(), adopter, Long.MAX_VALUE));
        adopter.resumedFrom = previous;
    }

    /** First RECIBO of a resumed session: the old ticket stops being valid. */
    public void settled(Session session) {
        long previous = session.resumedFrom;
        Resumable r = previous == 0 ? null : resumable.get(previous);
        if (r != null && r.holder() == session) {
            resumable.remove(previous, r);
        }
        session.resumedFrom = 0;
    }

    /** Dead sessions whose books are still alive (they reference works: files stay). */
    public List<Session> graves() {
        long now = System.nanoTime();
        resumable.values().removeIf(r -> r.expiresNs() < now);
        List<Session> out = new ArrayList<>();
        for (Resumable r : resumable.values()) {
            if (!live.containsKey(r.holder().id())) {
                out.add(r.holder());
            }
        }
        return out;
    }
}
