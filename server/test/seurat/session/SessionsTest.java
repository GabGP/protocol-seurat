package seurat.session;

import seurat.concession.Concession;
import seurat.kit.TestKit;

/** Sessions: single-use tokens, live registry, resumable books (spec 8). */
public final class SessionsTest {
    public static void main(String[] args) {
        tokenSingleUse();
        resumable();
        idempotentUntilFirstReceipt();
        renewedAtDisconnect();
        retiredSessionIsPruned();
        liveSessionIsResumable();
        System.out.println("SessionsTest OK");
    }

    private static void tokenSingleUse() {
        Sessions sessions = new Sessions();
        String hex = sessions.issueToken("anonimo", "anonimo", 128, 120_000);
        TestKit.check(hex.length() == 64, "32B hex token");
        Sessions.Token first = sessions.consumeToken(hex);
        TestKit.check(first != null && first.memMib() == 128, "consume once");
        TestKit.check(sessions.consumeToken(hex) == null, "single use");
        TestKit.check(sessions.consumeToken("zz") == null, "unknown rejected");
    }

    private static void resumable() {
        Sessions sessions = new Sessions();
        byte[] ticket = new byte[32];
        ticket[0] = 7;
        Session session = new Session(9, "p", "anonimo", 128, 0, null, ticket);
        sessions.add(session);
        TestKit.check(sessions.find(9) == session, "registry");
        sessions.retire(session);
        TestKit.check(sessions.find(9) == null, "dead leaves registry");
        TestKit.check(sessions.resumable(9, ticket, "p").holder() == session, "book survives L + delta");
        TestKit.check(sessions.resumable(9, new byte[32], "p") == null, "wrong ticket");
        TestKit.check(sessions.resumable(9, ticket, "q") == null, "another principal");
        TestKit.check(sessions.graves().contains(session), "a grave references its works");
    }

    /**
     * Spec 8: at a disconnect, a delivery whose RENOVAR was not acknowledged yet expires at
     * t_desconexion + L + delta like an unacked one, not at its older t_acuse + L + delta
     * (the client may have applied that RENOVAR: invariant 3, client within the book).
     */
    private static void renewedAtDisconnect() {
        Sessions sessions = new Sessions();
        Session session = new Session(4, "p", "anonimo", 128, 0, null, new byte[32]);
        Canvas canvas = new Canvas(1, "w", null, new seurat.store.WorkMeta("w", "w", 512, 512, 256, 2, 3, 2, 0, 2),
                new Concession(1, 0, 4, 1, 768, 36864, 120));
        session.canvases().put(1L, canvas);
        long renewed = canvas.book().log(new seurat.codec.BrushId(0, 0, 0), 0, 2, 100, 1).number();
        long plain = canvas.book().log(new seurat.codec.BrushId(0, 1, 0), 0, 2, 100, 1).number();
        long s = 1_000_000_000L;
        long acked = System.nanoTime() - 100 * s; // acknowledged 100 s ago: vence_srv in ~21 s
        canvas.book().acknowledge(seurat.proto.Ranges.of(renewed, plain), acked, 120 * s, s);
        canvas.orders().addRenewal(canvas.orders().next(), seurat.proto.Ranges.of(renewed));
        sessions.retire(session);
        seurat.proto.Ranges gone = canvas.book().pruneExpired(System.nanoTime() + 60 * s);
        TestKit.check(gone.contains(plain), "acknowledged, not renewed: keeps t_acuse + L + delta");
        TestKit.check(!gone.contains(renewed), "renewed, unacknowledged: t_desconexion + L + delta");
    }

    /** A retry after a lost BIENVENIDA gives the same result; the first RECIBO ends that. */
    private static void idempotentUntilFirstReceipt() {
        Sessions sessions = new Sessions();
        byte[] ticket = new byte[32];
        Session old = new Session(1, "p", "anonimo", 128, 0, null, ticket);
        sessions.retire(old);
        Session first = new Session(2, "p", "anonimo", 128, 0, null, new byte[32]);
        sessions.adopted(1, sessions.resumable(1, ticket, "p"), first);
        sessions.retire(first); // BIENVENIDA lost, connection dead again
        Sessions.Resumable again = sessions.resumable(1, ticket, "p");
        TestKit.check(again != null && again.holder() == first, "retry adopts from the first adopter");
        Session second = new Session(3, "p", "anonimo", 128, 0, null, new byte[32]);
        sessions.add(second);
        sessions.adopted(1, again, second);
        sessions.settled(second);
        TestKit.check(sessions.resumable(1, ticket, "p") == null, "old ticket dies at the first RECIBO");
    }

    /** A retired session leaves memory at L + delta with no disk reaper or later resume attempt. */
    private static void retiredSessionIsPruned() {
        Sessions sessions = new Sessions();
        byte[] ticket = new byte[32];
        Session session = new Session(5, "p", "anonimo", 128, 0, null, ticket);
        sessions.add(session);
        sessions.retire(session);
        long now = System.nanoTime();
        long lease = seurat.config.SeuratConstants.LEASE_S * seurat.config.Units.NANOS_PER_S;
        sessions.pruneExpired(now + lease / 2);
        TestKit.check(sessions.resumable(5, ticket, "p") != null, "still resumable inside L + delta");
        sessions.pruneExpired(now + lease + 10 * seurat.config.Units.NANOS_PER_S);
        TestKit.check(sessions.resumable(5, ticket, "p") == null, "pruned after L + delta");
        TestKit.check(!sessions.graves().contains(session), "no grave keeps the session alive");
    }

    /** The client saw the link die before the server did: the old session is still live and answers to its ticket. */
    private static void liveSessionIsResumable() {
        Sessions sessions = new Sessions();
        byte[] ticket = new byte[32];
        ticket[0] = 3;
        Session old = new Session(6, "p", "anonimo", 128, 0, null, ticket);
        sessions.add(old);
        Sessions.Resumable r = sessions.resumable(6, ticket, "p");
        TestKit.check(r != null && r.holder() == old, "a live session is resumable under its ticket");
        TestKit.check(sessions.resumable(6, new byte[32], "p") == null, "not under another ticket");
        TestKit.check(sessions.resumable(6, ticket, "q") == null, "not for another principal");
        Session next = new Session(7, "p", "anonimo", 128, 0, null, new byte[32]);
        sessions.add(next);
        sessions.adopted(6, r, next);
        sessions.retire(old); // the half-open socket finally closes
        TestKit.check(sessions.resumable(6, ticket, "p").holder() == next, "its retire does not take the books back");
    }
}
