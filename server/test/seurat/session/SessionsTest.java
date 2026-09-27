package seurat.session;

import seurat.kit.TestKit;

/** Sessions: single-use tokens, live registry, resumable books (spec 8). */
public final class SessionsTest {
    public static void main(String[] args) {
        tokenSingleUse();
        resumable();
        idempotentUntilFirstReceipt();
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
}
