async function createIfMissing(db, tableName, builder) {
  if (!(await db.schema.hasTable(tableName))) {
    await db.schema.createTable(tableName, builder);
  }
}

async function ensureColumn(db, tableName, columnName, builder) {
  if (!(await db.schema.hasColumn(tableName, columnName))) {
    await db.schema.alterTable(tableName, builder);
  }
}

export async function ensureSchema(db) {
  await createIfMissing(db, 'users', (t) => {
    t.increments('id');
    t.string('google_id').unique().notNullable();
    t.string('email').notNullable();
    t.string('consented_at');
    t.string('created_at').defaultTo(db.fn.now());
  });

  await createIfMissing(db, 'guidance_logs', (t) => {
    t.increments('id');
    t.string('user_id').notNullable();
    t.string('platform');
    t.string('url');
    t.text('original_message');
    t.boolean('is_answer_seeking');
    t.float('confidence');
    t.text('suggestion');
    t.string('user_action');
    t.text('final_message');
    t.string('created_at').defaultTo(db.fn.now());
    t.index('user_id');
    t.index('platform');
  });

  await createIfMissing(db, 'message_logs', (t) => {
    t.increments('id');
    t.string('user_id').notNullable();
    t.string('chat_id');
    t.string('platform');
    t.string('url');
    t.text('message_text').notNullable();
    t.text('assistant_response');
    t.string('message_hash');
    t.string('captured_at').defaultTo(db.fn.now());
    t.unique(['user_id', 'message_hash']);
    t.index('user_id');
    t.index('chat_id');
    t.index('captured_at');
  });

  // Migration: add chat_id to existing message_logs tables
  await ensureColumn(db, 'message_logs', 'chat_id', (t) => t.string('chat_id'));
}
