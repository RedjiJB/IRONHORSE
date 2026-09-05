// Posts (DOMAIN-DESIGN.md §5, resolved 2026-09-04: per-post granular
// certification requirements, soft flag not hard block). A post is a
// specific position within a site, not the site itself -- required certs
// attach here.
import { pool } from "../db/pool.js";

export type Post = {
  id: string;
  site_id: string;
  name: string;
  active: boolean;
  created_at: string;
};

export async function createPost(args: { siteId: string; name: string }): Promise<Post> {
  const result = await pool.query(
    `INSERT INTO posts (site_id, name) VALUES ($1, $2) RETURNING *`,
    [args.siteId, args.name],
  );
  return result.rows[0] as Post;
}

export async function listPosts(filter?: { siteId?: string }): Promise<Post[]> {
  if (filter?.siteId) {
    const result = await pool.query("SELECT * FROM posts WHERE site_id = $1 ORDER BY name", [filter.siteId]);
    return result.rows as Post[];
  }
  const result = await pool.query("SELECT * FROM posts ORDER BY name");
  return result.rows as Post[];
}

export async function getPost(id: string): Promise<Post | null> {
  const result = await pool.query("SELECT * FROM posts WHERE id = $1", [id]);
  return (result.rows[0] as Post) ?? null;
}

export type PostRequiredCertification = {
  id: string;
  post_id: string;
  cert_type: string;
  created_at: string;
};

export async function addRequiredCertification(args: { postId: string; certType: string }): Promise<PostRequiredCertification> {
  const result = await pool.query(
    `INSERT INTO post_required_certifications (post_id, cert_type) VALUES ($1, $2) RETURNING *`,
    [args.postId, args.certType],
  );
  return result.rows[0] as PostRequiredCertification;
}

export async function listRequiredCertifications(postId: string): Promise<PostRequiredCertification[]> {
  const result = await pool.query(
    "SELECT * FROM post_required_certifications WHERE post_id = $1 ORDER BY cert_type",
    [postId],
  );
  return result.rows as PostRequiredCertification[];
}
