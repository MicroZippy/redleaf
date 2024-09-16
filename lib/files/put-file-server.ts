import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DocumentStorageType } from "@prisma/client";
import slugify from "@sindresorhus/slugify";
import { put } from "@vercel/blob";
import path from "node:path";
import { match } from "ts-pattern";

import { newId } from "@/lib/id-helper";

import { getS3Client } from "./aws-client";

// `File` is a web API type and not available server-side, so we need to define our own type
type File = {
  name: string;
  type: string;
  buffer: Buffer;
};

export const putFileServer = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId?: string;
}) => {
  const NEXT_PUBLIC_UPLOAD_TRANSPORT = process.env.NEXT_PUBLIC_UPLOAD_TRANSPORT;

  const { type, data } = await match(NEXT_PUBLIC_UPLOAD_TRANSPORT)
    .with("s3", async () => putFileInS3Server({ file, teamId, docId }))
    .with("vercel", async () => putFileInVercelServer(file))
    .otherwise(() => {
      return {
        type: null,
        data: null,
        numPages: undefined,
      };
    });

  return { type, data };
};

const putFileInVercelServer = async (file: File) => {
  const contents = file.buffer;

  const blob = await put(file.name, contents, {
    access: "public",
  });

  return {
    type: DocumentStorageType.VERCEL_BLOB,
    data: blob.url,
  };
};

const putFileInS3Server = async ({
  file,
  teamId,
  docId,
}: {
  file: File;
  teamId: string;
  docId?: string;
}) => {
  if (!docId) {
    docId = newId("doc");
  }

  if (
    file.type !== "image/png" &&
    file.type !== "image/jpeg" &&
    file.type !== "application/pdf"
  ) {
    throw new Error("Only PNG, JPEG or PDF files are supported");
  }

  const client = getS3Client();

  // Get the basename and extension for the file
  const { name, ext } = path.parse(file.name);

  const key = `${teamId}/${docId}/${slugify(name)}${ext}`;

  const buffer = file.buffer;

  const params = {
    Bucket: process.env.NEXT_PRIVATE_UPLOAD_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: file.type,
  };

  // Create a new instance of the PutObjectCommand with the parameters
  const command = new PutObjectCommand(params);

  // Send the command to S3
  await client.send(command);

  return {
    type: DocumentStorageType.S3_PATH,
    data: key,
  };
};
