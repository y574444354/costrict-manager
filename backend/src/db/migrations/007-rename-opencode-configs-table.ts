import type { Migration } from '../migration-runner'

const migration: Migration = {
  version: 7,
  name: 'rename-opencode-configs-table',

  up(db) {
    // 重命名表从opencode_configs到costrict_configs
    db.run(`
      ALTER TABLE opencode_configs RENAME TO costrict_configs
    `)

    // 重命名索引
    db.run(`
      ALTER INDEX idx_opencode_user_id RENAME TO idx_costrict_user_id
    `)
    db.run(`
      ALTER INDEX idx_opencode_default RENAME TO idx_costrict_default
    `)
  },

  down(db) {
    // 回滚时重命名表回到opencode_configs
    db.run(`
      ALTER TABLE costrict_configs RENAME TO opencode_configs
    `)

    // 回滚时重命名索引
    db.run(`
      ALTER INDEX idx_costrict_user_id RENAME TO idx_opencode_user_id
    `)
    db.run(`
      ALTER INDEX idx_costrict_default RENAME TO idx_opencode_default
    `)
  },
}

export default migration