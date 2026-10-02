export const HTTP_REASONS: Readonly<Record<number, string>> = {
  0: 'Connection lost',
  400: 'Empty or unreadable request',
  403: 'Only allowed from the server machine',
  409: 'Already in the gallery',
  415: 'Not a supported image',
  502: 'Download failed',
  507: 'Server disk is full',
};

/** Look up user-facing failure reason from an HTTP status code. */
export function reasonForStatus(status: number): string {
  return HTTP_REASONS[status] ?? `Server error ${status}`;
}

export const reasonOf = reasonForStatus;
export const reasonFromStatus = reasonForStatus;
