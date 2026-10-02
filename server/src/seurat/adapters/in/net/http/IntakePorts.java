package seurat.adapters.in.net.http;

import java.nio.file.Path;
import java.util.function.Consumer;
import seurat.adapters.in.inbox.PathImport;
import seurat.adapters.in.inbox.PutUpload;
import seurat.adapters.in.inbox.UrlDownload;

/** Ports used by HTTP intake routes to upload, link or download masters into inbox. */
public record IntakePorts(PutUpload upload, PathImport paths, UrlDownload links, Consumer<Path> arrived) {
}
