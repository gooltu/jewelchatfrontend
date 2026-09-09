// TODO: confirm bucket/region once the S3 profile-pic bucket is provisioned (not live yet).
const PROFILE_PIC_BUCKET = 'jewelchat-profile-pics';
const PROFILE_PIC_REGION = 'ap-south-1';

/** `<JID>/profilepic.png` convention. The bucket doesn't exist yet — every load 404s until it does. */
export function getProfilePicUrl(jid: string): string {
  return `https://${PROFILE_PIC_BUCKET}.s3.${PROFILE_PIC_REGION}.amazonaws.com/${encodeURIComponent(jid)}/profilepic.png`;
}
