package seurat.core.viewing.plan;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import seurat.core.shared.codec.BrushId;
import seurat.core.shared.codec.Morton;
import seurat.core.shared.config.SeuratConstants;

/** Splits cone wants into the 3 ordered passes (sketch, density, fringe). */
final class ConePasses {
    private ConePasses() {}

    static ConePlanner.ConePlan split(Map<BrushId, Integer> want, List<BrushId> focus,
            BookView book, long cx, long cy, int flags, int top) {
        var core = new HashSet<BrushId>(focus);
        for (BrushId brush : focus) {
            BrushId parent = brush.parentCapped(top);
            while (true) {
                core.add(parent);
                if (parent.stratum() >= SeuratConstants.SEED_STRATUM) {
                    break;
                }
                parent = parent.parentCapped(top);
            }
        }
        core.add(BrushId.seed());
        Map<BrushId, Integer> held = new HashMap<>();
        List<PlanEntry> pass1 = new ArrayList<>();
        List<PlanEntry> pass2 = new ArrayList<>();
        List<PlanEntry> pass3 = new ArrayList<>();
        for (var need : want.entrySet()) {
            BrushId brush = need.getKey();
            int wantBands = need.getValue();
            int have = held.getOrDefault(brush, book.bands(brush));
            if (wantBands <= have) {
                continue;
            }
            if (core.contains(brush)) {
                if (have < Math.min(wantBands, 2)) {
                    pass1.add(new PlanEntry(brush, have, Math.min(wantBands, 2), 1));
                    have = Math.min(wantBands, 2);
                }
                if (have < wantBands) {
                    pass2.add(new PlanEntry(brush, Math.max(have, 2), wantBands, 2));
                }
            } else {
                pass3.add(new PlanEntry(brush, have, wantBands, 3));
            }
            held.put(brush, wantBands);
        }
        Comparator<PlanEntry> order = Comparator
                .comparingInt((PlanEntry pe) -> pe.brush().stratum()).reversed()
                .thenComparingLong(pe -> ConeTiling.dist2(pe.brush(), cx, cy))
                .thenComparingLong(pe -> Morton.encode(pe.brush().bx(), pe.brush().by()));
        pass1.sort(order);
        pass2.sort(order);
        pass3.sort(order);
        List<PlanEntry> all = new ArrayList<>(pass1.size() + pass2.size() + pass3.size());
        all.addAll(pass1);
        all.addAll(pass2);
        all.addAll(pass3);
        if (all.size() > SeuratConstants.PLAN_MAX_ENTRIES) {
            return new ConePlanner.ConePlan(all.subList(0, SeuratConstants.PLAN_MAX_ENTRIES), flags);
        }
        return new ConePlanner.ConePlan(List.copyOf(all), flags);
    }

}
