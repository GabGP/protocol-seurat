package seurat.core.works.catalog;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import seurat.core.shared.proto.msg.MsgCatalog;

/** The OBRA observers and the message one work change becomes (spec 7.3). */
final class CatalogEvents {
    private final List<Consumer<MsgCatalog.WorkMessage>> listeners = new CopyOnWriteArrayList<>();

    void observe(Consumer<MsgCatalog.WorkMessage> listener) {
        listeners.add(listener);
    }

    /** Emits the work's current meta as `event` with `progress` percent. */
    void emit(WorkRecord work, int event, int progress) {
        MsgCatalog.WorkMessage message = message(work, event, progress);
        listeners.forEach(listener -> listener.accept(message));
    }

    static MsgCatalog.WorkMessage message(WorkRecord work, int event, int progress) {
        return new MsgCatalog.WorkMessage(event, work.meta.state(), progress,
                work.meta.edition(), work.meta.width(), work.meta.height(),
                work.meta.strata(), work.meta.id(), work.meta.name());
    }
}
