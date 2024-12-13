const SPACES_ENDPOINT = process.env.SPACES_ENDPOINT || 'your-region.digitaloceanspaces.com';
const BUCKET_NAME = process.env.BUCKET_NAME || 'your-bucket-name';

export function getSpacesUrl(key: string): string {
  return `https://${BUCKET_NAME}.${SPACES_ENDPOINT}/${key}`;
}
