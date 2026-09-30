package seurat.catalog;

import java.io.IOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import seurat.config.Units;
import seurat.proto.ProtoCodes;
import seurat.proto.msg.MsgCatalog;
import seurat.store.BrushStore;

/** id -> work map + meta.json. Every change is pushed as OBRA to its observers (spec 7.3). */
public final class Catalog {
    private final CatalogStore disk;
    private final CatalogEvents events = new CatalogEvents();
    private final WorkProgress progress = new WorkProgress();
    private final Map<String, WorkRecord> records = new ConcurrentHashMap<>();

    public Catalog(Path worksDir) throws IOException {
        this.disk = new CatalogStore(worksDir);
    }

    public void observe(Consumer<MsgCatalog.WorkMessage> listener) {
        events.observe(listener);
    }

    public void register(WorkRecord work) throws IOException {
        WorkRecord previous = records.put(work.meta.id(), work);
        progress.reset(work.meta.id()); // a new pass counts from 0
        if (previous != null) {
            work.ceilings.putAll(previous.ceilings); // a new master keeps the work's policy
        }
        disk.persist(work);
        events.emit(work, ProtoCodes.OBRA_ALTA, 0);
    }

    public void progress(String id, int pct) {
        WorkRecord work = records.get(id);
        if (work != null && progress.advance(id, pct)) {
            events.emit(work, ProtoCodes.OBRA_ESTADO, pct);
        }
    }

    /** Spec 7.1 step 4 begins: OBRA(ESTADO, PINTANDO, 0), then progress() on every whole percent. */
    public void painting(String id) {
        WorkRecord work = records.get(id);
        if (work != null) {
            progress.start(id);
            sketch(id, work.store, ProtoCodes.ST_PINTANDO, work.meta.edition());
        }
    }

    public void sketch(String id, BrushStore store, int state, long edition) {
        WorkRecord work = records.get(id);
        if (work != null) {
            work.store = store;
            work.meta = work.meta.with(state, edition);
            try {
                disk.persist(work);
            } catch (IOException ignored) {
            }
            if (state != ProtoCodes.ST_LISTA) { // LISTA is announced by OBRA(EDICION), see list()
                events.emit(work, ProtoCodes.OBRA_ESTADO, progress.of(id));
            }
        }
    }

    public void list(String id) {
        WorkRecord work = records.get(id);
        if (work != null) {
            events.emit(work, ProtoCodes.OBRA_EDICION, Units.PERCENT);
        }
    }

    /** DELETE (spec 7.4): RETIRADA persisted (a restart must not bring it back), then OBRA(BAJA). */
    public void withdraw(String id) {
        WorkRecord work = records.remove(id);
        progress.reset(id);
        if (work != null) {
            work.meta = work.meta.with(ProtoCodes.ST_RETIRADA, work.meta.edition());
            try {
                disk.persist(work);
            } catch (IOException ignored) {
            }
            events.emit(work, ProtoCodes.OBRA_BAJA, 0);
        }
    }

    /** CATALOGO: one OBRA(LISTADO) per work, with its current state and progress. */
    public List<MsgCatalog.WorkMessage> listing() {
        List<MsgCatalog.WorkMessage> out = new ArrayList<>();
        for (WorkRecord work : records.values()) {
            out.add(CatalogEvents.message(work, ProtoCodes.OBRA_LISTADO, progress.shown(work)));
        }
        return out;
    }

    /** PUT .../politica: the new ceilings (already valid, see RolePolicy) survive a restart. */
    public void policy(WorkRecord work, Map<String, long[]> ceilings) throws IOException {
        work.ceilings.putAll(ceilings);
        disk.persist(work);
    }

    public WorkRecord get(String id) {
        return records.get(id);
    }

    /** One skip rule for intake + job: LISTA with a usable store. */
    public boolean isCompleted(String id) {
        WorkRecord r = records.get(id);
        return r != null && r.store != null && r.meta != null
                && r.meta.state() == ProtoCodes.ST_LISTA;
    }

    public Iterable<WorkRecord> all() {
        return records.values();
    }

    /** Restart recovery: rebuild LISTA stores, truncate to the index. */
    public void load() throws IOException {
        records.putAll(WorkRecovery.readAll(disk.worksDir()));
    }
}
