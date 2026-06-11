import { deleteObject, getDownloadURL, storage, storageRef, uploadBytes } from "@/lib/firebase";

const sanitizePart = (value: string) =>
  String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "unknown";

export const buildProfilePhotoPath = (userId: string, file: File) => {
  const extFromName = (file.name.split(".").pop() || "jpg").toLowerCase();
  const ext = /^(jpg|jpeg|png|webp|gif)$/i.test(extFromName) ? extFromName : "jpg";
  return `profile-photos/${sanitizePart(userId)}/current_${Date.now()}.${ext}`;
};

export async function uploadProfilePhotoToFirebase(userId: string, file: File) {
  const path = buildProfilePhotoPath(userId, file);
  const fileRef = storageRef(storage, path);
  const snapshot = await uploadBytes(fileRef, file, {
    contentType: file.type || "image/jpeg",
    cacheControl: "public,max-age=31536000,immutable",
  });
  const url = await getDownloadURL(snapshot.ref);
  return { url, path };
}

export async function deleteProfilePhotoFromFirebase(path?: string | null) {
  if (!path) return;
  try {
    await deleteObject(storageRef(storage, path));
  } catch {
    // old file may already be gone; ignore
  }
}