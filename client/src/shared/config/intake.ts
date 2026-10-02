/** Mirrors server/src/seurat/core/works/catalog/MasterNames.java EXTENSIONS, keep in sync. */
export const MASTER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'tif', 'tiff', 'psb', 'psd'] as const;

/** Archive extensions unpacked by server intake. */
export const ARCHIVE_EXTENSIONS = ['zip'] as const;

/** File input accept string built from master and archive extensions with dots. */
export const INTAKE_ACCEPT = [...MASTER_EXTENSIONS, ...ARCHIVE_EXTENSIONS].map((ext) => `.${ext}`).join(',');

/** Format chips the drop zone shows. */
export const INTAKE_FORMATS = ['PNG', 'JPG', 'TIFF', 'PSB', 'PSD', 'ZIP'] as const;
