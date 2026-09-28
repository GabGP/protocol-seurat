package seurat.catalog;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Consumer;
import seurat.proto.MsgCatalog;
import seurat.proto.ProtoCodes;
import seurat.store.BrushStore;
import seurat.store.StoreFiles;

/** id -> work map + meta.json. Every change is pushed as OBRA to its observers (spec 7.3). */
public final class Catalog {
    private final Path worksDir;
    private final Map<String, WorkRecord> records = new ConcurrentHashMap<>();
    private final Map<String, Integer> lastPct = new ConcurrentHashMap<>();
    private final List<Consumer<MsgCatalog.WorkMessage>> listeners = new CopyOnWriteArrayList<>();

    public Catalog(Path worksDir) throws IOException {
        this.worksDir = worksDir;
        Files.createDirectories(worksDir);
    }

    public void observe(Consumer<MsgCatalog.WorkMessage> listener) {
        listeners.add(listener);
    }

    private void emit(MsgCatalog.WorkMessage message) {
        listeners.forEach(listener -> listener.accept(message));
    }

    public void register(WorkRecord work) throws IOException {
        WorkRecord previous = records.put(work.meta.id(), work);
        lastPct.remove(work.meta.id()); // a new pass counts from 0
        if (previous != null) {
            work.ceilings.putAll(previous.ceilings); // a new master keeps the work's policy
        }
        persist(work);
        emit(message(work, ProtoCodes.OBRA_ALTA, 0));
    }

    public void progress(String id, int pct) {
        WorkRecord work = records.get(id);
        if (work == null) {
            return;
        }
        Integer previous = lastPct.put(id, pct);
        if (previous == null || previous != pct) {
            emit(message(work, ProtoCodes.OBRA_ESTADO, pct));
        }
    }

    /** Spec 7.1 step 4 begins: OBRA(ESTADO, PINTANDO, 0), then progress() on every whole percent. */
    public void painting(String id) {
        WorkRecord work = records.get(id);
        if (work != null) {
            lastPct.put(id, 0);
            sketch(id, work.store, ProtoCodes.ST_PINTANDO, work.meta.edition());
        }
    }

    public void sketch(String id, BrushStore store, int state, long edition) {
        WorkRecord work = records.get(id);
        if (work != null) {
            work.store = store;
            work.meta = work.meta.with(state, edition);
            try {
                persist(work);
            } catch (IOException ignored) {
            }
            if (state != ProtoCodes.ST_LISTA) { // LISTA is announced by OBRA(EDICION), see list()
                emit(message(work, ProtoCodes.OBRA_ESTADO, lastPct.getOrDefault(id, 0)));
            }
        }
    }

    public void list(String id) {
        WorkRecord work = records.get(id);
        if (work != null) {
            emit(message(work, ProtoCodes.OBRA_EDICION, 100));
        }
    }

    /** DELETE (spec 7.4): RETIRADA persisted (a restart must not bring it back), then OBRA(BAJA). */
    public void withdraw(String id) {
        WorkRecord work = records.remove(id);
        lastPct.remove(id);
        if (work != null) {
            work.meta = work.meta.with(ProtoCodes.ST_RETIRADA, work.meta.edition());
            try {
                persist(work);
            } catch (IOException ignored) {
            }
            emit(message(work, ProtoCodes.OBRA_BAJA, 0));
        }
    }

    /** CATALOGO: one OBRA(LISTADO) per work, with its current state and progress. */
    public java.util.List<MsgCatalog.WorkMessage> listing() {
        java.util.List<MsgCatalog.WorkMessage> out = new java.util.ArrayList<>();
        for (WorkRecord work : records.values()) {
            int pct = work.meta.state() == ProtoCodes.ST_LISTA ? 100 : lastPct.getOrDefault(work.meta.id(), 0);
            out.add(message(work, ProtoCodes.OBRA_LISTADO, pct));
        }
        return out;
    }

    /** PUT .../politica: the new ceilings (already valid, see RolePolicy) survive a restart. */
    public void policy(WorkRecord work, Map<String, long[]> ceilings) throws IOException {
        work.ceilings.putAll(ceilings);
        persist(work);
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
        records.putAll(WorkRecovery.readAll(worksDir));
    }

    private MsgCatalog.WorkMessage message(WorkRecord work, int event, int progress) {
        return new MsgCatalog.WorkMessage(event, work.meta.state(), progress,
                work.meta.edition(), work.meta.width(), work.meta.height(),
                work.meta.strata(), work.meta.id(), work.meta.name());
    }

    private void persist(WorkRecord work) throws IOException {
        Path dir = worksDir.resolve(work.meta.id());
        Files.createDirectories(dir);
        Files.writeString(dir.resolve(StoreFiles.META), MetaJson.write(work));
    }
}
