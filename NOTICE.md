# Content licences

The source code is MIT-licensed ([LICENSE](LICENSE)). Content the museum displays or bundles
keeps its own licence:

- Text in data/cache/ (artist bios, painting stories, facts, period
  descriptions) is quoted from English Wikipedia and is licensed under
  CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/); each entry
  links back to its source article.
- Painting images and portraits are not bundled; they are loaded from
  Wikimedia Commons / Wikipedia, each under the licence on its file page.
  Images of works still in copyright (labelled "© In copyright" in the
  gallery) remain the property of their rights holders and are withheld on
  request (src/lib/takedowns.ts).
- Music in public/audio/ is mirrored from Wikimedia Commons; each recording
  keeps its own licence (public domain, CC0, CC BY or CC BY-SA), listed with
  attribution in public/audio/CREDITS.md.
- The audio guide's Pocket voices (its natural voice, the default) are not
  bundled either: the visitor's browser downloads them from Hugging Face and
  runs them on the visitor's device (public/voice/pocket-worker.js,
  public/voice/pocket-core.js). Pocket TTS by Kyutai
  (https://huggingface.co/kyutai/pocket-tts-without-voice-cloning), CC BY 4.0
  (https://creativecommons.org/licenses/by/4.0/); converted for the browser
  with lookbe/pocket-tts-onnx-export (MIT); browser loop after
  KevinAHM/pocket-tts-web (Apache 2.0). Voices: Alba (Alba Mackenna, CC BY
  4.0), Jane, George, Michael (VCTK corpus, CC BY 4.0). Kyutai's terms of use
  apply to the speech the model makes: no voice impersonation without the
  speaker's consent, and generated speech is never to be presented as a
  genuine recording of a real person.
