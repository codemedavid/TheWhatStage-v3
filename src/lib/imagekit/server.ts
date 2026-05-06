import ImageKit from 'imagekit'

let _client: ImageKit | null = null

export function getImageKit(): ImageKit {
  if (!_client) {
    _client = new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY!,
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY!,
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT!,
    })
  }
  return _client
}
