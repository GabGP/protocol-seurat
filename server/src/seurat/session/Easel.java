package seurat.session;

import java.util.concurrent.BlockingQueue;
import seurat.observe.Log;
import seurat.observe.LogTags;
import seurat.observe.LogUnits;
import seurat.proto.FatalProtocol;
import seurat.proto.Frame;
import seurat.proto.FrameType;
import seurat.proto.MsgError;
import seurat.proto.ProtoCodes;
import seurat.proto.Wire;

/**
 * Caballete: one virtual thread per session, the only writer of its session state.
 * Its input loop is ordered, so a RASPADO is read after every earlier SOLTAR (spec 4.2.5).
 */
public final class Easel implements Runnable {
    private final Mapping mapping;
    private final BlockingQueue<byte[]> entry;
    private final EaselContext ctx;

    public Easel(Mapping mapping, BlockingQueue<byte[]> entry, EaselContext ctx) {
        this.mapping = mapping;
        this.entry = entry;
        this.ctx = ctx;
    }

    public static void send(Mapping mapping, long type, byte[] payload) {
        try {
            mapping.sendControl(new Frame(type, payload).encode());
        } catch (Exception ex) {
            throw new RuntimeException(ex);
        }
    }

    @Override
    public void run() {
        Session session = null;
        String reason = "disconnect";
        try {
            session = new SessionHandshake(mapping, entry, ctx).hello();
            loop(session, new CanvasService(mapping, ctx), new LoanHandlers(mapping, ctx));
            reason = "ADIOS"; // the loop only returns on ADIOS
        } catch (java.io.EOFException ex) {
            reason = "disconnect";
        } catch (FatalProtocol fail) {
            reason = ProtoCodes.errorName(fail.code);
            Log.warn(LogTags.SESSION, subject(session) + " fatal error=" + reason
                    + " ref=" + FrameType.name(fail.refType) + ": " + fail.getMessage());
            fail(fail.code, fail.refType, fail.getMessage());
        } catch (Throwable ex) {
            reason = "error";
            Log.error(LogTags.SESSION, subject(session) + " failed: " + LogUnits.cause(ex), ex);
            fail(ProtoCodes.ERR_INTERNO, 0, "interno");
        } finally {
            close(session, reason);
        }
    }

    /** ERROR with fatal = 1 precedes the close (spec 3.3); a protocol failure closes with 1002. */
    private void fail(int code, long refType, String msg) {
        try {
            send(mapping, FrameType.ERROR, new MsgError.ProtocolError(code, 1, refType, msg).encode());
        } catch (RuntimeException ignored) {
        }
        mapping.fail();
    }

    private static String subject(Session session) {
        return session == null ? "handshake" : "s" + session.id();
    }

    /** One line per close, whatever ended it; a session's books stay L + delta for REANUDAR. */
    private void close(Session session, String reason) {
        try {
            mapping.close();
        } catch (Exception ignored) {
        }
        Log.info(LogTags.SESSION, subject(session) + " closed reason=" + reason + (session == null ? "" : " books=kept"));
        if (session != null) {
            session.canvases().values().forEach(ctx.grants()::drop);
            ctx.gazes().forget(session);
            ctx.sessions().retire(session);
        }
    }

    private byte[] take() throws Exception {
        byte[] f = entry.take();
        if (f.length == 0) {
            throw new java.io.EOFException("control closed");
        }
        return f;
    }

    private void loop(Session session, CanvasService service, LoanHandlers loans) throws Exception {
        for (;;) {
            byte[] raw = take();
            Frame f = Wire.parse(0, () -> Frame.decodeExact(raw));
            long type = f.type();
            if (Log.isDebugEnabled()) {
                Log.debug(LogTags.PROTO, "s" + session.id() + " received " + FrameType.name(type));
            }
            if (type == FrameType.MIRADA) {
                service.gaze(session, f);
            } else if (type == FrameType.RECIBO) {
                loans.receipt(session, f);
            } else if (type == FrameType.SOLTAR) {
                loans.release(session, f);
            } else if (type == FrameType.RASPADO) {
                loans.scraped(session, f);
            } else if (type == FrameType.INVENTARIO) {
                loans.inventory(session, f);
            } else if (type == FrameType.ABRIR) {
                service.open(session, f);
            } else if (type == FrameType.CERRAR) {
                service.closeCanvas(session, f);
            } else if (type == FrameType.CATALOGO) {
                service.sendCatalog(session, f);
            } else if (type == FrameType.ECO) {
                service.echo(session, f);
            } else if (type == FrameType.ADIOS) {
                return;
            } else if (Frame.mandatory(type)) {
                // Known S->C types (BIENVENIDA, CONCESION, ...) are just as invalid from a client.
                throw new FatalProtocol(ProtoCodes.ERR_PROTOCOLO, type, "unexpected mandatory type");
            }
        }
    }
}
