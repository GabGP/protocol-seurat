package seurat.core.viewing.easel;

import seurat.core.viewing.grant.GazeGate;
import seurat.core.viewing.grant.GrantController;
import seurat.core.viewing.session.Sessions;
import seurat.core.works.catalog.Catalog;

/** Server-wide collaborators every Easel (one per session) works with. */
public record EaselContext(Sessions sessions, Catalog catalog, GrantController grants,
        GazeGate gazes, int sessionMax, long rateBytesPerS) {}
