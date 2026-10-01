package seurat.core.viewing.easel;

import seurat.core.shared.observe.Log;
import seurat.core.shared.observe.LogTags;
import seurat.core.shared.proto.FrameType;
import seurat.core.shared.proto.ProtoCodes;
import seurat.core.shared.proto.msg.MsgError;
import seurat.core.viewing.session.Canvas;
import seurat.core.viewing.session.Mapping;
import seurat.core.viewing.session.Session;

/** Finds the canvas a frame names. An unknown handle is ERROR 6 (not fatal) and the frame is skipped. */
final class HandleLookup {
    private HandleLookup() {}

    /** The canvas, or null after answering ERROR 6 to the frame of `type`. */
    static Canvas find(Mapping mapping, Session session, long handle, long type) {
        Canvas canvas = session.canvases().get(handle);
        if (canvas == null) {
            Log.warn(LogTags.SESSION, "s" + session.id() + " invalid handle=" + handle);
            mapping.send(FrameType.ERROR, new MsgError.ProtocolError(
                    ProtoCodes.ERR_HANDLE, 0, type, "handle " + handle).encode());
        }
        return canvas;
    }
}
