// 授業資料エディタ(/editor/)のページを、npm run dev の時だけ返す。
//
// エディタのAPIや css/js は scripts/editor-server.mjs のViteミドルウェアが配信している。
// ところがHTMLを求めるリクエスト(= ブラウザでURLを開いた時)だけは、Astro自身が
// Viteのミドルウェアより先に受け取ってルーティングし、知らないパスなのでAstroの404を返す。
// curlでは開けるのにブラウザだと404、という状態になるため、HTMLだけはここで返す。
//
// import.meta.env.DEV の分岐により、npm run build (静的ビルド)では素通りする。
// エディタは講師の手元専用で、公開サイトには出さない。
import fs from 'node:fs';
import path from 'node:path';
import type { MiddlewareHandler } from 'astro';

const EDITOR_HTML = path.join(process.cwd(), 'editor', 'index.html');

export const onRequest: MiddlewareHandler = (context, next) => {
  if (!import.meta.env.DEV) return next();

  const { pathname } = new URL(context.request.url);
  // baseが付いた形(/Vantan-.../editor/)で来ても開けるようにしておく
  const local = pathname.replace(/^\/Vantan-JuniorHighSchool-Programming/, '');
  if (local !== '/editor' && local !== '/editor/') return next();

  return new Response(fs.readFileSync(EDITOR_HTML, 'utf8'), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
};
