/**
 * Data storage for Telegram bot
 * Author subscriptions support
 */

import prisma from './db';

// ===== TYPES =====

export interface UserData {
  id: number;
  chatId: number;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  isActive: boolean;
  isAdmin: boolean;
  isBlocked: boolean;
  joinedAt: Date;
  lastActivityAt: Date;
  postsReceived: number;
  tagSets: TagSetData[];
  authorSubs: AuthorSubData[];
}

export interface TagSetData {
  id: number;
  name: string;
  isActive: boolean;
  includeTags: string[];
  excludeTags: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthorSubData {
  id: number;
  authorUsername: string;
  authorName?: string | null;
  isActive: boolean;
  sendPreview: boolean;
  createdAt: Date;
}

export interface PostData {
  id: string;
  title: string;
  link: string;
  author?: string;
  authorName?: string;
  rating: number;
  images: string[];
  tags: string[];
  bodyPreview?: string;
  commentsCount: number;
  parsedAt: string;
}

export interface BotSettings {
  botToken: string | null;
  parseIntervalMinutes: number;
  maxTagSetsPerUser: number;
  maxTagsPerSet: number;
  maxAuthorSubs: number;
  isActive: boolean;
}

// ===== SETTINGS =====

export async function getSettings(): Promise<BotSettings> {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } });
  }
  return settings;
}

export async function updateSettings(updates: Partial<BotSettings>): Promise<BotSettings> {
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    update: updates,
    create: { id: 1, ...updates },
  });
  return settings;
}

// ===== USERS =====

export async function getUser(chatId: number): Promise<UserData | null> {
  const user = await prisma.user.findUnique({
    where: { chatId: BigInt(chatId) },
    include: {
      tagSets: { orderBy: { createdAt: 'asc' } },
      authorSubs: { orderBy: { createdAt: 'desc' } },
    },
  });

  if (!user) return null;
  return mapUser(user);
}

function mapUser(user: any): UserData {
  return {
    id: user.id,
    chatId: Number(user.chatId),
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    isAdmin: user.isAdmin,
    isBlocked: user.isBlocked,
    joinedAt: user.joinedAt,
    lastActivityAt: user.lastActivityAt,
    postsReceived: user.postsReceived,
    tagSets: (user.tagSets || []).map((ts: any) => ({
      id: ts.id,
      name: ts.name,
      isActive: ts.isActive,
      includeTags: JSON.parse(ts.includeTags || '[]'),
      excludeTags: JSON.parse(ts.excludeTags || '[]'),
      createdAt: ts.createdAt,
      updatedAt: ts.updatedAt,
    })),
    authorSubs: (user.authorSubs || []).map((as: any) => ({
      id: as.id,
      authorUsername: as.authorUsername,
      authorName: as.authorName,
      isActive: as.isActive,
      sendPreview: as.sendPreview,
      createdAt: as.createdAt,
    })),
  };
}

export async function createUser(
  chatId: number,
  userInfo?: { username?: string; firstName?: string; lastName?: string }
): Promise<UserData> {
  const adminExists = await prisma.user.findFirst({ where: { isAdmin: true } });

  const user = await prisma.user.upsert({
    where: { chatId: BigInt(chatId) },
    update: {
      username: userInfo?.username,
      firstName: userInfo?.firstName,
      lastName: userInfo?.lastName,
      lastActivityAt: new Date(),
    },
    create: {
      chatId: BigInt(chatId),
      username: userInfo?.username,
      firstName: userInfo?.firstName,
      lastName: userInfo?.lastName,
      isAdmin: !adminExists,
    },
    include: { tagSets: true, authorSubs: true },
  });

  await updateGlobalStats({ totalUsers: await prisma.user.count() });
  return mapUser(user);
}

export async function updateUser(chatId: number, updates: Partial<Omit<UserData, 'chatId' | 'tagSets' | 'authorSubs' | 'id'>>): Promise<UserData | null> {
  try {
    const user = await prisma.user.update({
      where: { chatId: BigInt(chatId) },
      data: updates,
      include: { tagSets: true, authorSubs: true },
    });
    return mapUser(user);
  } catch {
    return null;
  }
}

export async function deleteUser(chatId: number): Promise<boolean> {
  try {
    await prisma.user.delete({ where: { chatId: BigInt(chatId) } });
    await updateGlobalStats({ totalUsers: await prisma.user.count() });
    return true;
  } catch {
    return false;
  }
}

export async function getAllUsers(): Promise<UserData[]> {
  const users = await prisma.user.findMany({
    include: { tagSets: true, authorSubs: true },
    orderBy: { joinedAt: 'desc' },
  });
  return users.map(mapUser);
}

export async function getAllActiveUsers(): Promise<UserData[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, isBlocked: false },
    include: {
      tagSets: { where: { isActive: true } },
      authorSubs: { where: { isActive: true } },
    },
  });
  return users.map(mapUser);
}

// ===== ADMIN =====

export async function blockUser(chatId: number): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { chatId: BigInt(chatId) },
      data: { isBlocked: true, isActive: false },
    });
    return true;
  } catch {
    return false;
  }
}

export async function unblockUser(chatId: number): Promise<boolean> {
  try {
    await prisma.user.update({
      where: { chatId: BigInt(chatId) },
      data: { isBlocked: false, isActive: true },
    });
    return true;
  } catch {
    return false;
  }
}

// ===== AUTHOR SUBSCRIPTIONS =====

export async function addAuthorSubscription(
  chatId: number,
  authorUsername: string,
  authorName?: string
): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const user = await getUser(chatId);

  if (!user) return { success: false, error: 'User not found' };

  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  if (user.authorSubs.length >= settings.maxAuthorSubs) {
    return { success: false, error: `Max ${settings.maxAuthorSubs} subscriptions` };
  }

  if (user.authorSubs.some(s => s.authorUsername.toLowerCase() === normalized)) {
    return { success: false, error: 'Already subscribed' };
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { chatId: BigInt(chatId) },
      select: { id: true },
    });

    if (!dbUser) return { success: false, error: 'User not found' };

    await prisma.authorSubscription.create({
      data: {
        userId: dbUser.id,
        authorUsername: normalized,
        authorName: authorName,
      },
    });

    return { success: true };
  } catch {
    return { success: false, error: 'Subscription error' };
  }
}

export async function removeAuthorSubscription(chatId: number, authorUsername: string): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  try {
    await prisma.authorSubscription.deleteMany({
      where: {
        user: { chatId: BigInt(chatId) },
        authorUsername: normalized,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function toggleAuthorSubscription(chatId: number, authorUsername: string): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  try {
    const sub = await prisma.authorSubscription.findFirst({
      where: {
        user: { chatId: BigInt(chatId) },
        authorUsername: normalized,
      },
    });

    if (sub) {
      await prisma.authorSubscription.update({
        where: { id: sub.id },
        data: { isActive: !sub.isActive },
      });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function setAuthorPreviewMode(chatId: number, authorUsername: string, sendPreview: boolean): Promise<boolean> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  try {
    await prisma.authorSubscription.updateMany({
      where: {
        user: { chatId: BigInt(chatId) },
        authorUsername: normalized,
      },
      data: { sendPreview },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getSubscribersForAuthor(authorUsername: string): Promise<UserData[]> {
  const normalized = authorUsername.toLowerCase().replace(/^@/, '');

  const subs = await prisma.authorSubscription.findMany({
    where: { authorUsername: normalized, isActive: true },
    include: { user: { include: { tagSets: true, authorSubs: true } } },
  });

  return subs.map(s => mapUser(s.user));
}

// ===== TAG SETS =====

export async function getTagSet(tagSetId: number): Promise<TagSetData | null> {
  const ts = await prisma.tagSet.findUnique({ where: { id: tagSetId } });
  if (!ts) return null;

  return {
    id: ts.id,
    name: ts.name,
    isActive: ts.isActive,
    includeTags: JSON.parse(ts.includeTags || '[]'),
    excludeTags: JSON.parse(ts.excludeTags || '[]'),
    createdAt: ts.createdAt,
    updatedAt: ts.updatedAt,
  };
}

export async function createTagSet(chatId: number, name: string): Promise<{ success: boolean; tagSet?: TagSetData; error?: string }> {
  const settings = await getSettings();
  const user = await getUser(chatId);

  if (!user) return { success: false, error: 'User not found' };
  if (user.tagSets.length >= settings.maxTagSetsPerUser) {
    return { success: false, error: `Max ${settings.maxTagSetsPerUser} sets` };
  }
  if (user.tagSets.some(ts => ts.name.toLowerCase() === name.toLowerCase())) {
    return { success: false, error: 'Set already exists' };
  }

  try {
    const dbUser = await prisma.user.findUnique({
      where: { chatId: BigInt(chatId) },
      select: { id: true },
    });

    if (!dbUser) return { success: false, error: 'User not found' };

    const ts = await prisma.tagSet.create({
      data: {
        userId: dbUser.id,
        name: name.trim().slice(0, 50),
      },
    });

    return {
      success: true,
      tagSet: {
        id: ts.id,
        name: ts.name,
        isActive: ts.isActive,
        includeTags: [],
        excludeTags: [],
        createdAt: ts.createdAt,
        updatedAt: ts.updatedAt,
      },
    };
  } catch {
    return { success: false, error: 'Create error' };
  }
}

export async function updateTagSet(tagSetId: number, updates: { name?: string; isActive?: boolean; includeTags?: string[]; excludeTags?: string[] }): Promise<TagSetData | null> {
  try {
    const ts = await prisma.tagSet.update({
      where: { id: tagSetId },
      data: {
        name: updates.name,
        isActive: updates.isActive,
        includeTags: updates.includeTags ? JSON.stringify(updates.includeTags) : undefined,
        excludeTags: updates.excludeTags ? JSON.stringify(updates.excludeTags) : undefined,
      },
    });

    return {
      id: ts.id,
      name: ts.name,
      isActive: ts.isActive,
      includeTags: JSON.parse(ts.includeTags || '[]'),
      excludeTags: JSON.parse(ts.excludeTags || '[]'),
      createdAt: ts.createdAt,
      updatedAt: ts.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function deleteTagSet(tagSetId: number): Promise<boolean> {
  try {
    await prisma.tagSet.delete({ where: { id: tagSetId } });
    return true;
  } catch {
    return false;
  }
}

// ===== TAGS =====

export async function addIncludeTag(tagSetId: number, tag: string): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const ts = await getTagSet(tagSetId);

  if (!ts) return { success: false, error: 'Set not found' };

  const normalized = tag.toLowerCase().trim();
  if (ts.includeTags.includes(normalized)) return { success: false, error: 'Tag already added' };
  if (ts.includeTags.length >= settings.maxTagsPerSet) {
    return { success: false, error: `Max ${settings.maxTagsPerSet} tags` };
  }

  await updateTagSet(tagSetId, { includeTags: [...ts.includeTags, normalized] });
  return { success: true };
}

export async function removeIncludeTag(tagSetId: number, tag: string): Promise<boolean> {
  const ts = await getTagSet(tagSetId);
  if (!ts) return false;

  const normalized = tag.toLowerCase().trim();
  await updateTagSet(tagSetId, { includeTags: ts.includeTags.filter(t => t !== normalized) });
  return true;
}

export async function addExcludeTag(tagSetId: number, tag: string): Promise<{ success: boolean; error?: string }> {
  const settings = await getSettings();
  const ts = await getTagSet(tagSetId);

  if (!ts) return { success: false, error: 'Set not found' };

  const normalized = tag.toLowerCase().trim();
  if (ts.excludeTags.includes(normalized)) return { success: false, error: 'Tag already added' };
  if (ts.excludeTags.length >= settings.maxTagsPerSet) {
    return { success: false, error: `Max ${settings.maxTagsPerSet} tags` };
  }

  await updateTagSet(tagSetId, { excludeTags: [...ts.excludeTags, normalized] });
  return { success: true };
}

export async function removeExcludeTag(tagSetId: number, tag: string): Promise<boolean> {
  const ts = await getTagSet(tagSetId);
  if (!ts) return false;

  const normalized = tag.toLowerCase().trim();
  await updateTagSet(tagSetId, { excludeTags: ts.excludeTags.filter(t => t !== normalized) });
  return true;
}

// ===== POSTS =====

export async function isPostSeen(postId: string): Promise<boolean> {
  const post = await prisma.seenPost.findUnique({ where: { postId }, select: { id: true } });
  return !!post;
}

export async function addSeenPost(post: PostData): Promise<number> {
  try {
    const created = await prisma.seenPost.create({
      data: {
        postId: post.id,
        title: post.title?.slice(0, 500),
        link: post.link,
        author: post.author,
        authorName: post.authorName,
        rating: post.rating,
        images: JSON.stringify(post.images),
        tags: JSON.stringify(post.tags),
        bodyPreview: post.bodyPreview?.slice(0, 500),
        commentsCount: post.commentsCount,
        parsedAt: new Date(post.parsedAt),
      },
    });
    return created.id;
  } catch {
    const existing = await prisma.seenPost.findUnique({ where: { postId: post.id } });
    return existing?.id || 0;
  }
}

export async function getSeenPost(postId: string): Promise<PostData | null> {
  const post = await prisma.seenPost.findUnique({ where: { postId } });
  if (!post) return null;

  return {
    id: post.postId,
    title: post.title || '',
    link: post.link || '',
    author: post.author || undefined,
    authorName: post.authorName || undefined,
    rating: post.rating,
    images: post.images ? JSON.parse(post.images) : [],
    tags: post.tags ? JSON.parse(post.tags) : [],
    bodyPreview: post.bodyPreview || undefined,
    commentsCount: post.commentsCount,
    parsedAt: post.parsedAt.toISOString(),
  };
}

export async function hasUserReceivedPost(chatId: number, postId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { chatId: BigInt(chatId) }, select: { id: true } });
  if (!user) return false;

  const post = await prisma.seenPost.findUnique({ where: { postId }, select: { id: true } });
  if (!post) return false;

  const userPost = await prisma.userPost.findUnique({
    where: { userId_postId: { userId: user.id, postId: post.id } },
  });

  return !!userPost;
}

export async function recordUserPost(chatId: number, postId: number, isPreview: boolean = false): Promise<void> {
  const user = await prisma.user.findUnique({ where: { chatId: BigInt(chatId) }, select: { id: true } });
  if (!user) return;

  try {
    await prisma.userPost.create({
      data: { userId: user.id, postId, isPreview },
    });
  } catch { }
}

// ===== DIALOGS =====

export async function getDialogState(chatId: number): Promise<{ state: string; data: any } | null> {
  const state = await prisma.dialogState.findUnique({ where: { chatId: BigInt(chatId) } });
  if (!state) return null;
  return { state: state.state, data: state.data ? JSON.parse(state.data) : null };
}

export async function setDialogState(chatId: number, state: string, data?: any): Promise<void> {
  await prisma.dialogState.upsert({
    where: { chatId: BigInt(chatId) },
    update: { state, data: data ? JSON.stringify(data) : null },
    create: { chatId: BigInt(chatId), state, data: data ? JSON.stringify(data) : null },
  });
}

export async function clearDialogState(chatId: number): Promise<void> {
  await prisma.dialogState.delete({ where: { chatId: BigInt(chatId) } }).catch(() => { });
}

// ===== STATS =====

export async function updateGlobalStats(updates: Partial<{ totalUsers: number; totalPostsSent: number; totalPreviews: number; totalParses: number; parseErrors: number; lastParseAt: Date; lastError: string; lastErrorAt: Date }>): Promise<void> {
  await prisma.globalStats.upsert({
    where: { id: 1 },
    update: updates,
    create: { id: 1, ...updates },
  });
}

export async function incrementUserPostsReceived(chatId: number): Promise<void> {
  await prisma.user.update({
    where: { chatId: BigInt(chatId) },
    data: { postsReceived: { increment: 1 } },
  });
}

export async function incrementGlobalPostsSent(count: number = 1, isPreview: boolean = false): Promise<void> {
  const update: any = { totalPostsSent: { increment: count } };
  if (isPreview) {
    update.totalPreviews = { increment: count };
  }

  await prisma.globalStats.update({ where: { id: 1 }, data: update });
}

export async function recordParseTime(): Promise<void> {
  await prisma.globalStats.update({
    where: { id: 1 },
    data: { totalParses: { increment: 1 }, lastParseAt: new Date() },
  });
}

export async function recordParseError(error: string): Promise<void> {
  await prisma.globalStats.update({
    where: { id: 1 },
    data: { parseErrors: { increment: 1 }, lastError: error, lastErrorAt: new Date() },
  });
}

// ===== DETAILED STATS =====

export async function getDetailedStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const [
    totalUsers,
    activeUsers,
    blockedUsers,
    usersWithTagSets,
    usersWithAuthorSubs,
    totalTagSets,
    activeTagSets,
    allTagSets,
    totalAuthorSubs,
    globalStats,
    postsToday,
    postsThisWeek,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true, isBlocked: false } }),
    prisma.user.count({ where: { isBlocked: true } }),
    prisma.user.count({ where: { tagSets: { some: {} } } }),
    prisma.user.count({ where: { authorSubs: { some: {} } } }),
    prisma.tagSet.count(),
    prisma.tagSet.count({ where: { isActive: true } }),
    prisma.tagSet.findMany({ select: { includeTags: true, excludeTags: true } }),
    prisma.authorSubscription.count({ where: { isActive: true } }),
    prisma.globalStats.findUnique({ where: { id: 1 } }),
    prisma.userPost.count({ where: { sentAt: { gte: todayStart } } }),
    prisma.userPost.count({ where: { sentAt: { gte: weekStart } } }),
  ]);

  let totalIncludeTags = 0;
  let totalExcludeTags = 0;

  for (const ts of allTagSets) {
    totalIncludeTags += (JSON.parse(ts.includeTags || '[]') as string[]).length;
    totalExcludeTags += (JSON.parse(ts.excludeTags || '[]') as string[]).length;
  }

  return {
    users: { total: totalUsers, active: activeUsers, blocked: blockedUsers, withTagSets: usersWithTagSets, withAuthorSubs: usersWithAuthorSubs },
    tagSets: { total: totalTagSets, active: activeTagSets },
    tags: { include: totalIncludeTags, exclude: totalExcludeTags },
    authorSubs: totalAuthorSubs,
    posts: {
      totalSent: globalStats?.totalPostsSent || 0,
      previews: globalStats?.totalPreviews || 0,
      today: postsToday,
      thisWeek: postsThisWeek,
    },
    parses: {
      total: globalStats?.totalParses || 0,
      errors: globalStats?.parseErrors || 0,
      lastAt: globalStats?.lastParseAt || null,
    },
  };
}

export async function getPopularTags(): Promise<{ tag: string; count: number }[]> {
  const tagSets = await prisma.tagSet.findMany({ select: { includeTags: true } });

  const tagCounts = new Map<string, number>();

  for (const ts of tagSets) {
    const tags = JSON.parse(ts.includeTags || '[]') as string[];
    for (const tag of tags) {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  return Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

export async function getPopularAuthors(): Promise<{ author: string; count: number }[]> {
  const subs = await prisma.authorSubscription.findMany({ select: { authorUsername: true } });

  const authorCounts = new Map<string, number>();

  for (const s of subs) {
    authorCounts.set(s.authorUsername, (authorCounts.get(s.authorUsername) || 0) + 1);
  }

  return Array.from(authorCounts.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);
}

// ===== LOGS =====

export async function addLog(action: string, details: string, chatId?: number): Promise<void> {
  await prisma.log.create({ data: { chatId, action, details } });

  const count = await prisma.log.count();
  if (count > 500) {
    const oldLogs = await prisma.log.findMany({
      take: count - 500,
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    await prisma.log.deleteMany({ where: { id: { in: oldLogs.map(l => l.id) } } });
  }
}

export async function getLogs(limit: number = 50): Promise<any[]> {
  const logs = await prisma.log.findMany({
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  return logs.map(l => ({
    id: l.id,
    timestamp: l.createdAt,
    chatId: l.chatId,
    action: l.action,
    details: l.details,
  }));
}
