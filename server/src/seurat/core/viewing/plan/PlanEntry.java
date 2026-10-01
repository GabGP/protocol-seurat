package seurat.core.viewing.plan;

import seurat.core.shared.codec.BrushId;

/** One planned delivery: brush bands [from,through) in pass 1/2/3. */
public record PlanEntry(BrushId brush, int from, int through, int pass) {}
