"""Prepare licensed public reference recordings for private Habibi tests only.
No AI inference, credentials, Modal calls or customer billing. WAV outputs stay
outside the repository. Repository evidence contains provenance, never media.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import urllib.parse
import urllib.request
import wave

REPO = Path(__file__).resolve().parents[1]
CODE_REVISION = '3b4d793481f1a8e686a2229c6d7946c5d9f6b8c0'
DATA_REVISION = '1d247ff668738d824c400cdefc542df6499f8c5e'
LICENSE_URL = f'https://huggingface.co/datasets/SWivid/Habibi/blob/{DATA_REVISION}/README.md'
RAW_CARD = f'https://huggingface.co/datasets/SWivid/Habibi/raw/{DATA_REVISION}/README.md'
ASSET_README = f'https://raw.githubusercontent.com/SWivid/Habibi-TTS/{CODE_REVISION}/src/habibi_tts/assets/README.md'
IRQ_URL = f'https://raw.githubusercontent.com/SWivid/Habibi-TTS/{CODE_REVISION}/src/habibi_tts/assets/IRQ.wav'
IRQ_SHA = 'd6180049f407364cc6667ad6903ba5e55a2b00f002d17ffe16a685199859fca4'


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Mashhad-private-reference-audit'})
    with urllib.request.urlopen(request, timeout=45) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024:
        raise ValueError('REFERENCE_DOWNLOAD_TOO_LARGE')
    return data


def inspect(data):
    with wave.open(io.BytesIO(data), 'rb') as audio:
        result = {'sampleRate': audio.getframerate(), 'channels': audio.getnchannels(),
                  'bitsPerSample': audio.getsampwidth() * 8, 'samples': audio.getnframes(),
                  'durationMs': round(audio.getnframes() / audio.getframerate() * 1000)}
        if audio.getcomptype() != 'NONE' or not 5000 <= result['durationMs'] <= 12000:
            raise ValueError('REFERENCE_WAV_POLICY')
    return result


def dataset_reference(config, index):
    metadata_url = ('https://datasets-server.huggingface.co/rows?' + urllib.parse.urlencode({
        'dataset': 'SWivid/Habibi', 'config': config, 'split': 'test', 'offset': index, 'length': 1}))
    row = json.loads(fetch(metadata_url))['rows'][0]
    if row['row_idx'] != index:
        raise ValueError('REFERENCE_ROW_CHANGED')
    item = row['row']
    url = item['audio'][0]['src']
    expected = f'https://datasets-server.huggingface.co/cached-assets/SWivid/Habibi/--/{DATA_REVISION}/--/{config}/test/{index}/audio/'
    if not url.startswith(expected) or not item['text'].strip():
        raise ValueError('REFERENCE_REVISION_CHANGED')
    return fetch(url), item['text'], url.split('?')[0], metadata_url


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--ffmpeg', type=Path, required=True)
    args = parser.parse_args()
    output = args.output_dir.resolve()
    if output.is_relative_to(REPO.resolve()) or not args.ffmpeg.is_file():
        raise ValueError('PRIVATE_REFERENCE_OUTPUT_OR_TOOL_INVALID')
    card = fetch(RAW_CARD)
    text = card.decode('utf-8')
    if 'license: apache-2.0' not in text or 'except for SAU' not in text:
        raise ValueError('REFERENCE_LICENSE_CHANGED')
    readme = fetch(ASSET_README).decode('utf-8')
    irq_transcript = readme.split('# IRQ.wav', 1)[1].split('\n', 1)[1].split('"', 2)[1]
    output.mkdir(parents=True, exist_ok=True)
    evidence = {'purpose': 'private_functional_tests_only', 'datasetRevision': DATA_REVISION,
                'sourceCodeRevision': CODE_REVISION, 'recordingLicense': 'Apache-2.0',
                'licenseSource': LICENSE_URL, 'licenseCardSHA256': hashlib.sha256(card).hexdigest(),
                'scope': 'Licensed benchmark use; no claimed human consent, endorsement, identity clearance or production voice publication.',
                'excluded': 'Official EGY/MSA MP3 examples originate from ElevenLabs voice library; not used.', 'references': []}
    for dialect, index in [('IRQ', None), ('EGY', 0), ('MSA', 2)]:
        if dialect == 'IRQ':
            data, transcript, source, metadata = fetch(IRQ_URL), irq_transcript, IRQ_URL, ASSET_README
            if hashlib.sha256(data).hexdigest() != IRQ_SHA:
                raise ValueError('IRQ_REFERENCE_CHANGED')
        else:
            data, transcript, source, metadata = dataset_reference(dialect, index)
        original = inspect(data)
        target = output / (dialect + '-16khz.wav')
        with tempfile.TemporaryDirectory(prefix='habibi-reference-') as temp:
            src, dst = Path(temp) / 'source.wav', Path(temp) / 'normalized.wav'
            src.write_bytes(data)
            subprocess.run([str(args.ffmpeg.resolve()), '-nostdin', '-hide_banner', '-loglevel', 'error',
                            '-i', str(src), '-map', '0:a:0', '-ac', '1', '-ar', '16000',
                            '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', str(dst)],
                           check=True, timeout=30, capture_output=True)
            converted = dst.read_bytes()
        normalized = inspect(converted)
        if (normalized['sampleRate'], normalized['channels'], normalized['bitsPerSample']) != (16000, 1, 16):
            raise ValueError('REFERENCE_PCM_POLICY')
        if abs(normalized['durationMs'] - original['durationMs']) > 1:
            raise ValueError('REFERENCE_DURATION_CHANGED')
        if target.exists() and target.read_bytes() != converted:
            raise ValueError('REFERENCE_OUTPUT_CONFLICT')
        target.write_bytes(converted)
        (output / (dialect + '-transcript.txt')).write_text(transcript, encoding='utf-8')
        evidence['references'].append({'dialect': dialect, 'modelId': 'habibi-' + dialect.lower(),
            'source': source, 'metadataSource': metadata, 'datasetRow': index,
            'transcript': transcript, 'transcriptSource': 'official benchmark row' if index is not None else 'official pinned assets README',
            'sourceSHA256': hashlib.sha256(data).hexdigest(), 'sourceAudio': original,
            'normalizedSHA256': hashlib.sha256(converted).hexdigest(), 'normalizedAudio': normalized,
            'localFileName': target.name, 'conversion': 'FFmpeg PCM resample only; no trim, padding, synthesis or transcript rewrite',
            'rightsAttestationKind': 'licensed', 'privateOnly': True, 'listeningVerified': False})
    manifest = json.dumps(evidence, ensure_ascii=False, indent=2) + '\n'
    (output / 'reference-evidence.json').write_text(manifest, encoding='utf-8')
    (REPO / 'docs/private-habibi-reference-evidence.json').write_text(manifest, encoding='utf-8')
    print(json.dumps({'status': 'prepared', 'dialects': [r['dialect'] for r in evidence['references']],
                      'outputDirectory': str(output), 'evidence': 'docs/private-habibi-reference-evidence.json'}))


if __name__ == '__main__':
    main()
