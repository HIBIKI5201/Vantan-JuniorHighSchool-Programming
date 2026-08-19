// 「制作中」の資料をサイトに出さないための共通処理。
//
// frontmatter に status: draft と書いた回は、公開されるサイト(npm run build)からは
// ページごと作られず、一覧にも出てこない。
//
// ただし npm run dev の時だけは表示する。
// 先生が授業前に下書きを読み返したり、書きながら見た目を確かめたりできるようにするため。
// (プレビューでは一覧に「制作中」バッジが付くので、公開されていないことが分かる)
//
// 公開したくなったら status を partial か complete に変えるだけでよい。

export const showDrafts = import.meta.env.DEV;

type HasStatus = { data: { status?: string } };

/** サイトに出してよい資料かどうか */
export function isPublished(entry: HasStatus): boolean {
	return showDrafts || entry.data.status !== "draft";
}
