// Content Collections設定。
// src/content/courses/*.md  = コース(金曜ゲーム、火曜ゲームなど)1件につき1ファイル
// src/content/lessons/<courseId>/*.md = そのコースの授業回1件につき1ファイル
import { defineCollection, z } from 'astro:content';

const courses = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(), // 例: "金曜ゲーム"
    period: z.string(), // 例: "2026 7~9月"
    dayOfWeek: z.string(), // 例: "金曜日"
    order: z.number().default(0), // トップページでの並び順(新しい期が上に来るように)
    status: z.enum(['complete', 'partial']).default('complete'),
    note: z.string().optional(), // partialの時の補足(画像未移行など)
  }),
});

const lessons = defineCollection({
  type: 'content',
  schema: z.object({
    course: z.string(), // coursesコレクションのslugと対応
    order: z.number(), // #0, #1, #2... の並び順
    title: z.string(), // 例: "#2 敵を作ろう"
    sessionDate: z.string().optional(),
    status: z.enum(['complete', 'partial']).default('complete'),
    note: z.string().optional(),
  }),
});

export const collections = { courses, lessons };
