const NOTION_API_VERSION = '2025-09-03';

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    'Notion-Version': NOTION_API_VERSION,
  };
}

/** 上傳圖片到 Notion 永久儲存，回傳 file_upload id（須在 1 小時內 attach 到頁面）。 */
export async function uploadImageToNotion(
  buffer: Buffer,
  filename: string,
  contentType = 'image/png'
): Promise<string> {
  const createRes = await fetch('https://api.notion.com/v1/file_uploads', {
    method: 'POST',
    headers: {
      ...notionHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename, content_type: contentType }),
  });

  if (!createRes.ok) {
    throw new Error(`Notion file_upload create failed: ${createRes.status} ${await createRes.text()}`);
  }

  const created = (await createRes.json()) as { id: string };
  const uploadId = created.id;

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), filename);

  const sendRes = await fetch(`https://api.notion.com/v1/file_uploads/${uploadId}/send`, {
    method: 'POST',
    headers: notionHeaders(),
    body: form,
  });

  if (!sendRes.ok) {
    throw new Error(`Notion file_upload send failed: ${sendRes.status} ${await sendRes.text()}`);
  }

  const sent = (await sendRes.json()) as { status?: string };
  if (sent.status !== 'uploaded') {
    throw new Error(`Notion file_upload status: ${sent.status ?? 'unknown'}`);
  }

  return uploadId;
}

/** 把已上傳的檔案掛到頁面的 Files 欄。file upload 需要較新的 Notion API。 */
export async function attachFileUploadToProperty(
  pageId: string,
  propertyName: string,
  fileUploadId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      ...notionHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        [propertyName]: wFileUpload(fileUploadId, filename),
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Notion attach file failed: ${res.status} ${await res.text()}`);
  }
}

export function wFileUpload(fileUploadId: string, name: string) {
  return {
    files: [{
      type: 'file_upload',
      file_upload: { id: fileUploadId },
      name,
    }],
  };
}
