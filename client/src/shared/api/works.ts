import { OBRAS_PATH } from '../config/protocol';

const NETWORK_FAILURE_STATUS = 0;

/** Failure during work rename or delete with the corresponding HTTP status code (0 for network drop). */
export class WorkEditError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`work edit http ${status}`);
    this.name = 'WorkEditError';
    this.status = status;
  }
}

/** Requests the server to rename a work. */
export async function renameWork(id: string, name: string): Promise<void> {
  try {
    const res = await fetch(`${OBRAS_PATH}${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: name,
    });
    if (!res.ok) {
      throw new WorkEditError(res.status);
    }
  } catch (err) {
    if (err instanceof WorkEditError) throw err;
    throw new WorkEditError(NETWORK_FAILURE_STATUS);
  }
}

/** Requests the server to delete a work. */
export async function deleteWork(id: string): Promise<void> {
  try {
    const res = await fetch(`${OBRAS_PATH}${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      throw new WorkEditError(res.status);
    }
  } catch (err) {
    if (err instanceof WorkEditError) throw err;
    throw new WorkEditError(NETWORK_FAILURE_STATUS);
  }
}
