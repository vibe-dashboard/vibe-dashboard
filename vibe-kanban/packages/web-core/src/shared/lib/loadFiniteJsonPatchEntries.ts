import { streamJsonPatchEntries } from '@/shared/lib/streamJsonPatchEntries';

export async function loadFiniteJsonPatchEntries<E>(
  url: string,
  options: {
    timeoutMs: number;
    replaySafeAppendOnly?: boolean;
  }
): Promise<E[]> {
  return await new Promise<E[]>((resolve, reject) => {
    let settled = false;

    const controller = streamJsonPatchEntries<E>(url, {
      replaySafeAppendOnly: options.replaySafeAppendOnly,
      onFinished: (allEntries) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        controller.close();
        resolve(allEntries);
      },
      onError: (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        controller.close();
        reject(err);
      },
    });

    const timeoutId = setTimeout(() => {
      if (settled) return;
      settled = true;
      controller.close();
      reject(new Error('Finite stream timed out'));
    }, options.timeoutMs);
  });
}
