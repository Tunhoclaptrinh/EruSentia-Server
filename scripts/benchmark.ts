import { dbPool } from '../src/infrastructure/database/postgres';

async function runBenchmark() {
  console.log('================================================================');
  console.log('⚡ DATABASE QUERY BENCHMARK (EXPLAIN ANALYZE)');
  console.log('================================================================\n');

  const client = await dbPool.connect();
  try {
    // 1. Benchmark: Explore Hot Templates
    console.log('Query 1: Explore Hot Templates with Rating & Fork ordering');
    const q1 = `
      EXPLAIN ANALYZE
      SELECT id, title, rating_avg, forks_count, views_count
      FROM templates
      WHERE deleted_at IS NULL AND is_public = TRUE
      ORDER BY rating_avg DESC, forks_count DESC
      LIMIT 10;
    `;
    const res1 = await client.query(q1);
    res1.rows.forEach((r: Record<string, any>) => console.log('  ', r['QUERY PLAN']));
    console.log('\n----------------------------------------------------------------\n');

    // 2. Benchmark: Full-text Search on GIN Index
    console.log('Query 2: Full-text Search for "architecture"');
    const q2 = `
      EXPLAIN ANALYZE
      SELECT id, title, slug
      FROM templates
      WHERE deleted_at IS NULL AND is_public = TRUE
        AND to_tsvector('english', title || ' ' || coalesce(description, '')) @@ to_tsquery('english', 'architecture')
      LIMIT 10;
    `;
    const res2 = await client.query(q2);
    res2.rows.forEach((r: Record<string, any>) => console.log('  ', r['QUERY PLAN']));
    console.log('\n================================================================');
    console.log('Benchmark completed successfully!');
    console.log('================================================================');
  } catch (error) {
    console.error('Benchmark failed:', error);
  } finally {
    client.release();
    await dbPool.end();
  }
}

runBenchmark();
