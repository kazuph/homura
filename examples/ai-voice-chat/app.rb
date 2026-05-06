# frozen_string_literal: true

require "sinatra"

CHAT_MODEL = "@cf/moonshotai/kimi-k2.6"
SYSTEM_PROMPT =
  "You are a helpful assistant. Reply to the spoken message clearly and keep the answer under 280 characters.".freeze
MAX_AUDIO_BYTES = 5 * 1024 * 1024
MAX_REPLY_CHARS = 280
LANGUAGES = {
  "auto" => "Auto detect",
  "en" => "English",
  "ja" => "Japanese"
}.freeze
SPEAKERS = { "luna" => "Luna", "stella" => "Stella", "orion" => "Orion" }.freeze
DEFAULT_SPEAKER = "luna"

def h(text)
  Rack::Utils.escape_html(text.to_s)
end

def normalize_speaker(name)
  key = name.to_s
  SPEAKERS.key?(key) ? key : DEFAULT_SPEAKER
end

def normalize_language(name)
  key = name.to_s
  LANGUAGES.key?(key) ? key : "auto"
end

def language_options(selected)
  current = normalize_language(selected)
  LANGUAGES
    .map do |value, label|
      selected_attr = value == current ? " selected" : ""
      %(<option value="#{h(value)}"#{selected_attr}>#{h(label)}</option>)
    end
    .join
end

def speaker_options(selected)
  current = normalize_speaker(selected)
  SPEAKERS
    .map do |value, label|
      selected_attr = value == current ? " selected" : ""
      %(<option value="#{h(value)}"#{selected_attr}>#{h(label)}</option>)
    end
    .join
end

def page(
  filename: nil,
  transcript: nil,
  reply: nil,
  audio_src: nil,
  speaker: DEFAULT_SPEAKER,
  language: "auto",
  error: nil
)
  error_html = error ? %(<p class="error" role="alert">#{h(error)}</p>) : ""
  filename_html =
    (
      if filename
        %(<p class="meta"><strong>Audio file:</strong> #{h(filename)}</p>)
      else
        ""
      end
    )
  transcript_html =
    (
      if transcript
        %(<section><h2>Transcript</h2><pre>#{h(transcript)}</pre></section>)
      else
        ""
      end
    )
  reply_html =
    if reply
      <<~HTML
        <section>
          <h2>Kimi reply</h2>
          <pre>#{h(reply)}</pre>
          <audio controls autoplay src="#{h(audio_src)}"></audio>
        </section>
      HTML
    else
      ""
    end

  <<~HTML
    <!doctype html>
    <html lang="en">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>ai-voice-chat</title>
      <style>
        :root { color-scheme: light dark; }
        body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 3rem auto; padding: 0 1rem 3rem; line-height: 1.5; }
        h1 { margin-bottom: .2rem; }
        p.note, p.meta { color: #666; margin-top: 0; }
        form, section { background: rgba(127, 127, 127, .08); border-radius: 1rem; padding: 1rem; margin-top: 1rem; }
        label { display: block; font-weight: 600; margin-bottom: .5rem; }
        input[type=file], select { display: block; width: 100%; box-sizing: border-box; padding: .7rem; margin-bottom: .8rem; font: inherit; }
        button { padding: .7rem 1rem; font: inherit; cursor: pointer; }
        pre { white-space: pre-wrap; margin: 0 0 1rem; font: inherit; }
        audio { width: 100%; }
        .error { color: #b00020; font-weight: 600; }
      </style>
    </head>
    <body>
      <h1>ai-voice-chat</h1>
      <p class="note">Upload one audio clip, transcribe it, answer it, then let Aura read the answer back.</p>
      #{error_html}
      <form action="/chat" method="post" enctype="multipart/form-data">
        <label for="audio">Audio clip</label>
        <input id="audio" type="file" name="audio" accept="audio/*" capture required>
        <label for="language">Whisper language hint</label>
        <select id="language" name="language">#{language_options(language)}</select>
        <label for="speaker">Aura speaker</label>
        <select id="speaker" name="speaker">#{speaker_options(speaker)}</select>
        <button type="submit">Transcribe, reply, and speak</button>
      </form>
      #{filename_html}
      #{transcript_html}
      #{reply_html}
    </body>
    </html>
  HTML
end

def ensure_audio!(uploaded)
  unless uploaded.respond_to?(:to_uint8_array)
    raise ArgumentError, "Choose an audio file first."
  end
  raise ArgumentError, "Audio file is empty." if uploaded.size.zero?
  if uploaded.size > MAX_AUDIO_BYTES
    raise ArgumentError, "Audio file must be 5 MB or smaller."
  end
  uploaded
end

def reply_prompt(transcript)
  <<~TEXT
    The user sent this speech transcript:
    #{transcript}

    Reply directly to the user in one short answer.
  TEXT
end

def transcribe_text_from(audio, language)
  current = normalize_language(language)
  return ai.transcribe_text(audio).to_s.strip if current == "auto"
  ai.transcribe_text(audio, language: current).to_s.strip
end

get "/" do
  content_type "text/html; charset=utf-8"
  page
end

post "/chat" do
  content_type "text/html; charset=utf-8"
  audio = ensure_audio!(params["audio"])
  speaker = normalize_speaker(params["speaker"])
  language = normalize_language(params["language"])
  transcript = transcribe_text_from(audio, language)
  if transcript.empty?
    status 502
    next(
      page(
        filename: audio.filename,
        speaker: speaker,
        language: language,
        error: "Whisper returned an empty transcript."
      )
    )
  end

  reply =
    ai
      .chat_text(
        reply_prompt(transcript),
        model: CHAT_MODEL,
        system: SYSTEM_PROMPT,
        max_tokens: 200
      )
      .to_s
      .strip[
      0,
      MAX_REPLY_CHARS
    ]
  reply = "The model returned an empty reply." if reply.empty?
  audio_src = ai.speak_data_url(reply, speaker: speaker, encoding: "mp3").to_s

  page(
    filename: audio.filename,
    transcript: transcript,
    reply: reply,
    audio_src: audio_src,
    speaker: speaker,
    language: language
  )
rescue ArgumentError => e
  status 422
  page(
    speaker: params["speaker"],
    language: params["language"],
    error: e.message
  )
rescue Cloudflare::AIError => e
  status 502
  page(
    speaker: params["speaker"],
    language: params["language"],
    error: e.message
  )
end
