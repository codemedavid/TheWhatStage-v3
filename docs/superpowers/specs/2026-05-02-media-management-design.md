# Media Management and RAG Image Sending Design

## Goal

Build a media manager where a user can organize reusable customer-facing images into named folders with descriptions, describe each image, and let the chatbot automatically attach the best matching images in Messenger replies.

The primary workflow is:

1. The business uploads review, sample, proof, or other reusable images into folders.
2. Folders and images have descriptions that explain when they should be used.
3. Knowledge documents can either describe image sending behavior generally or explicitly mention media by slug.
4. When a customer asks for images, samples, reviews, or a specific type of proof, RAG finds the relevant media and the Messenger worker sends the text reply plus up to 4 matching images.

## Product Scope

In scope for the first implementation:

- Create, rename, describe, and delete media folders.
- Upload multiple images into a selected folder in one action.
- Add one shared description during bulk upload, with optional per-image description overrides before saving.
- Edit an image name, slug, folder, and description after upload.
- Display folder image counts and image previews in the dashboard.
- Search media by folder name, folder description, image name, and image description.
- Use folder and image descriptions in RAG retrieval.
- Automatically send up to 4 matching images in Messenger after the text reply.
- Allow knowledge documents to explicitly reference media with `#folder-slug` and `@asset-slug`.

Out of scope for the first implementation:

- AI-generated image descriptions.
- Video or non-image media.
- Nested folders.
- Image editing or cropping.
- Per-channel media rules outside Messenger.
- Customer-facing public media galleries.

## Data Model

Add `public.media_folders`:

- `id uuid primary key`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `name text not null`, 1 to 80 chars
- `slug text not null`, unique per user, lowercase URL-safe
- `description text`, up to 2000 chars
- `position integer not null default 0`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Add `public.media_assets`:

- `id uuid primary key`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `folder_id uuid not null references public.media_folders(id) on delete cascade`
- `name text not null`, 1 to 120 chars
- `slug text not null`, unique per user
- `description text`, up to 4000 chars
- `storage_path text not null`
- `mime_type text not null`
- `byte_size integer not null`
- `width integer`
- `height integer`
- `position integer not null default 0`
- `is_archived boolean not null default false`
- `embedding_status text not null default 'pending' check in ('pending','indexed','stale')`
- `version integer not null default 0`
- `embedded_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Storage should use a dedicated `media-assets` bucket. Store files under:

```text
<user_id>/<folder_id>/<asset_id>-<safe-original-filename>
```

RLS:

- Users can fully manage their own folders and assets.
- Storage object writes require the first path segment to match `auth.uid()`.
- Reads for Messenger sending should use signed URLs or service-role generated public URLs, depending on bucket privacy. The first implementation should keep the bucket private and generate short-lived signed URLs for outbound sends.

## RAG Indexing

Extend the existing `knowledge_chunks` source model to include media assets:

- Add nullable `media_asset_id`.
- Update the one-source constraint to allow exactly one of document, FAQ, business item, or media asset.
- Add a unique `(media_asset_id, chunk_index)` constraint.
- Add `media_asset_id` to embedding jobs and ingest source kinds.

Each media asset indexes as one atomic chunk built from folder and image fields:

```text
# <image name>

Media folder: <folder name>
Folder slug: #<folder slug>
Folder description: <folder description>

Image slug: @<asset slug>
Image description: <asset description>
```

When a folder or asset changes, related media asset chunks become stale and are re-embedded. Folder description changes mark every asset in that folder stale because the folder text is part of each asset's searchable text.

## Explicit References in Knowledge Documents

Knowledge documents can refer to media using plain text tokens:

- `#folder-slug` references a media folder.
- `@asset-slug` references a specific image.

Media selection should inspect the retrieved text chunks used to build the chatbot answer and extract these references.

Selection priority:

1. Valid `@asset-slug` references from retrieved chunks, in retrieval order.
2. Semantic matches inside valid `#folder-slug` folders from retrieved chunks.
3. Folder-level fallback images from valid `#folder-slug` folders when the customer asks broadly.
4. General semantic media matches when no explicit references were found or fewer than 4 images were selected.

Invalid, missing, archived, or unauthorized references are ignored. The bot should not mention that a reference failed.

This supports instructions like:

```text
If a customer asks for reviews, answer briefly and send images from #image-review.
If they ask about Ryan's review, include @new-review-customer-ryan.
```

## Retrieval Flow

Add a media retrieval helper used by chatbot answering:

```ts
selectMediaForReply({
  userId,
  customerMessage,
  retrievedChunks,
  limit: 4,
})
```

Inputs:

- The customer's raw message.
- The retrieved chunks selected for the text answer.
- The user's ID.
- Limit, fixed to 4 for Messenger.

Ranking query text should combine:

- Customer message.
- Useful/ambiguous chunk content that influenced the text reply.
- Explicit media reference tokens found in those chunks.

The helper returns ordered media assets with:

- `id`
- `folderId`
- `name`
- `slug`
- `description`
- `storagePath`
- `signedUrl`
- `matchReason` for logging/debugging only

The text answer should remain grounded in normal knowledge context. Media matching is a parallel attachment decision and should not force the LLM to claim it sent images.

## Messenger Sending

Add a Messenger image helper:

```ts
sendMessengerImage({
  pageAccessToken,
  recipientPsid,
  imageUrl,
})
```

It should call the Facebook Send API with an image attachment payload.

Worker behavior:

1. Generate the text reply as today.
2. Select media for the reply, max 4.
3. Send and persist the text reply first.
4. Send selected images one by one.
5. Persist each outbound image message.
6. Mark the job done only after image send attempts finish.

Idempotency:

- Add job-side tracking for sent media, or store an outbound media message row keyed by `(job_id, media_asset_id)`.
- On retry, skip any media asset already sent for that job.
- If one image fails, log the failure and continue with the remaining images. The text reply should not be retried solely because an image failed after the text was already sent.

Message records should store enough metadata to identify outbound image messages in the inbox, including `media_asset_id`, Messenger message ID, and a compact body such as `[image] <asset name>`.

## Dashboard UX

Add a Media page under the dashboard navigation. The page should follow the existing restrained dashboard style.

Suggested layout:

- Header: "Media" with actions to create folder and upload images.
- Left panel: folder list with counts and selected state.
- Main panel: selected folder details and image grid/list.
- Empty state: create a folder or upload images.
- Bulk upload modal or page section:
  - Choose folder.
  - Select multiple files.
  - Add shared description.
  - Show each selected image with editable name and description.
  - Save uploads all images and creates asset rows.
- Image edit drawer or detail form:
  - Preview.
  - Name.
  - Slug.
  - Description.
  - Folder.
  - Archive/delete action.

The UI should make slugs visible because users will reference them in knowledge documents. Show folder references as `#folder-slug` and image references as `@asset-slug`.

## Error Handling

- Reject non-image files and unsupported MIME types before upload.
- Enforce file size limits consistent with the storage bucket.
- If storage upload succeeds but database insert fails, try to delete the uploaded object before returning the error.
- If embedding enqueue fails after media save, keep the media asset and mark it `pending` or `stale`; the cron worker can pick it up later.
- If signed URL creation fails during Messenger send, skip that image and log the failure.
- If no media matches, send only the text reply.

## Testing

Unit tests:

- Slug generation and validation.
- Media RAG text builder.
- Explicit reference extraction for `#folder-slug` and `@asset-slug`.
- Media selection priority and max-4 limit.
- Retriever/source type support for `media_asset`.
- Messenger worker idempotency for media retries.

Integration-style tests:

- Folder description change marks folder assets stale.
- Upload action creates folder asset rows and queues embeddings.
- Messenger worker sends text first, then up to 4 images.
- Missing explicit references fall back to semantic media matching.

Manual verification:

- Create a folder named "Reviews" with slug `image-review`.
- Upload at least 5 review images with varied descriptions.
- Add a knowledge document that says to send images from `#image-review` for review requests.
- Ask the test chat and Messenger a broad review question; confirm no more than 4 images are selected/sent.
- Ask for a specific engineer review; confirm the image with the engineer-related description ranks first.

