package seurat.easel;

import seurat.catalog.Catalog;
import seurat.grant.GazeGate;
import seurat.grant.GrantController;
import seurat.session.Sessions;

/** Server-wide collaborators every Easel (one per session) works with. */
public record EaselContext(Sessions sessions, Catalog catalog, GrantController grants,
        GazeGate gazes, int sessionMax, long rateBytesPerS) {}
