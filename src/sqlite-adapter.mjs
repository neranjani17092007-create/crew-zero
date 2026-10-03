export function sqliteAdapter(sql) {
  return {
    prepare(query) {
      return {
        bind(...args) {
          return {
            async first() { return sql.prepare(query).get(...args); },
            async run() { return { meta: { changes: Number(sql.prepare(query).run(...args).changes) } }; }
          };
        }
      };
    }
  };
}
