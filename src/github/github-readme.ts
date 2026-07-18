import { GithubHttpService } from './github-http';

/** `GET /repos/{owner}/{name}/readme` 回應的最小欄位。 */
export interface ReadmeEnvelope {
  content: string;
  encoding: string;
}

/**
 * 取得 repo 的 README 純文字內容（UTF-8），沿用既有 `GithubHttpService`（FR-010，不另建
 * 平行請求層）。取不到／404／其他錯誤／非預期編碼一律回 `''`，交由呼叫端走退回素材（FR-008）。
 */
export async function fetchReadme(
  http: GithubHttpService,
  owner: string,
  name: string,
): Promise<string> {
  let envelope: ReadmeEnvelope;
  try {
    envelope = await http.getJson<ReadmeEnvelope>(
      `https://api.github.com/repos/${owner}/${name}/readme`,
    );
  } catch {
    return '';
  }
  if (envelope.encoding !== 'base64') {
    return '';
  }
  return Buffer.from(envelope.content, 'base64').toString('utf-8');
}
