import { describe, it, expect } from 'vitest'
import { youtubeId } from './_office-videos.js'

describe('youtubeId', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/watch?v=dQw4w9WgXcQ&t=30s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('reads the video id from %s', (url, id) => {
    expect(youtubeId(url)).toBe(id)
  })

  it.each([
    'https://www.youtube.com/playlist?list=PLabc',
    'https://www.youtube.com/@somechannel',
    'https://vimeo.com/123456789',
    'https://evil.example/watch?v=dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short',
    'not a link',
    '',
  ])('refuses %s', url => {
    expect(youtubeId(url)).toBe(null)
  })
})
