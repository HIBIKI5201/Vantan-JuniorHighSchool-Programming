---
name: deploy
description: devブランチの変更をmainにPRしてマージし、GitHub Pagesに公開する時に使う。「mainにマージして」「デプロイして」「公開して」「PR出してマージして」のような依頼で使う。コミット→devへpush→PR作成→マージ→デプロイの完了確認までを、いつも同じ手順で行うためのもの。
---

# mainにPRしてマージする(公開する)

このリポジトリは `main` にpushされると `.github/workflows/deploy.yaml` が自動でビルドし、
GitHub Pages(`https://hibiki5201.github.io/Vantan-JuniorHighSchool-Programming/`)に公開される。
**mainにマージする = 生徒が見るサイトに出る** ということなので、手順を飛ばさないこと。

作業は `dev` ブランチで行い、`dev` → `main` のPRを作ってマージする。
mainに直接pushはしない(これまでのマージも全部PR経由: #2, #3, #4 …)。

## 手順

### 1. 状態を確認する

```bash
git branch --show-current
git status --short
git fetch origin
git log --oneline origin/main..HEAD
```

- 今のブランチが `dev` でなければ、先にユーザーに確認する
- `_notion-source/` やスクショの元フォルダなど、コミットしてはいけないものが混ざっていないか見る
  (`_notion-source/` は `.gitignore` 済みだが、念のため)
- `origin/main` に `dev` に無いコミットがある時は、先に `git merge origin/main` で取り込んでおく
  (過去の「Merge remote-tracking branch 'origin/main' into dev」がこれ)

### 2. 検査とビルドを通す

```bash
npm run check
npm run build
```

- `npm run check` は **エラー0** であること。警告は既存のものが残っていてよいが、
  今回触った回に新しい警告が出ていたら、ユーザーに伝えてから進める
- `status: complete` の回でスクショが足りない、などはここで気付ける
- どちらかが失敗したら、マージせずに直す

### 3. コミットしてdevにpushする

未コミットの変更があればコミットする。メッセージはこのリポジトリの形に揃える。

```
[add] 金曜#5を公開、スクショ取り込みのルールをlesson-writerスキルに追記
[update] #4にDefenseLineの手順を追加してスクショと授業日を入れる
```

- 先頭は `[add]`(新しく足した)か `[update]`(直した)
- 本文は日本語で、何をしたかを1行で。コースは「金曜#5」「水曜#4」のように書く
- 最後にセッションで指定されている `Co-Authored-By` の行を付ける

```bash
git push origin dev
```

### 4. PRを作る

```bash
gh pr create --base main --head dev --title "<コミットと同じ形のタイトル>" --body "<箇条書き>"
```

- 本文は、今回mainに入る変更を箇条書きにする(`git log --oneline origin/main..dev` で確認)。
  前回のマージ以降に積んだコミットが全部入るので、今回の作業分だけでなく全部を書く
- 本文の最後にセッションで指定されているPR用の署名行を付ける
- すでに `dev` → `main` のPRが開いている時は、新しく作らずにそれを使う
  (`gh pr list --base main --head dev`)

### 5. マージする

```bash
gh pr merge <番号> --merge
```

- **`--merge` を使う。** squashやrebaseにしない(これまでの履歴が全部「Merge pull request」の形)
- **`--delete-branch` は付けない。** `dev` はずっと使い続けるブランチ
- マージできない(コンフリクトなど)時は、手順1の `git merge origin/main` からやり直す

### 6. デプロイが終わるのを確認する

```bash
gh run list --branch main --limit 1
gh run watch <run-id> --exit-status
```

- `completed success` になったら公開完了
- 失敗したら `gh run view <run-id> --log-failed` でログを見て、原因をユーザーに伝える

### 7. 報告する

- PRのリンク(`https://github.com/HIBIKI5201/Vantan-JuniorHighSchool-Programming/pull/<番号>`)
- 何が公開されたか(どのコースの何回目、スキルの変更など)
- デプロイが終わったか。終わっていなければ「まだ実行中」と正直に書く
- 公開先: https://hibiki5201.github.io/Vantan-JuniorHighSchool-Programming/

## 気を付けること

- `status: draft` の回は公開サイトに出ないので、書きかけの回が混ざっていてもマージしてよい。
  ただし `complete` / `partial` にした回は生徒に見えるので、内容が仕上がっているか確かめる
- このスキルを呼ばれた = マージと公開まで頼まれている、と考えてよい。
  ただし手順2で失敗した時や、今回触っていない大きな変更がdevに混ざっていた時は、止めて確認する
