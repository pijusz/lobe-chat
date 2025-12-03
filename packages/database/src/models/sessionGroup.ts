import { asc, desc, eq } from 'drizzle-orm';

import { SessionGroupItem, sessionGroups } from '../schemas';
import { LobeChatDatabase } from '../type';
import { idGenerator } from '../utils/idGenerator';

export class SessionGroupModel {
  private userId: string;
  private db: LobeChatDatabase;

  constructor(db: LobeChatDatabase, userId: string) {
    this.userId = userId;
    this.db = db;
  }

  create = async (params: { name: string; sort?: number }) => {
    const [result] = await this.db
      .insert(sessionGroups)
      .values({ ...params, id: this.genId(), userId: this.userId })
      .returning();

    return result;
  };

  delete = async (id: string) => {
    return this.db.delete(sessionGroups).where(eq(sessionGroups.id, id));
  };

  deleteAll = async () => {
    return this.db.delete(sessionGroups);
  };

  query = async () => {
    return this.db.query.sessionGroups.findMany({
      orderBy: [asc(sessionGroups.sort), desc(sessionGroups.createdAt)],
    });
  };

  findById = async (id: string) => {
    return this.db.query.sessionGroups.findFirst({
      where: eq(sessionGroups.id, id),
    });
  };

  update = async (id: string, value: Partial<SessionGroupItem>) => {
    return this.db
      .update(sessionGroups)
      .set({ ...value, updatedAt: new Date() })
      .where(eq(sessionGroups.id, id));
  };

  updateOrder = async (sortMap: { id: string; sort: number }[]) => {
    await this.db.transaction(async (tx) => {
      const updates = sortMap.map(({ id, sort }) => {
        return tx
          .update(sessionGroups)
          .set({ sort, updatedAt: new Date() })
          .where(eq(sessionGroups.id, id));
      });

      await Promise.all(updates);
    });
  };

  private genId = () => idGenerator('sessionGroups');
}
