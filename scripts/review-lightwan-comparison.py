"""CPU-only validation and review of existing successful comparison output."""
from pathlib import Path
import hashlib,json,re,subprocess,sys
ROOT=Path(__file__).resolve().parents[1]
WORK=(ROOT/'../../work/afterlife-film-20261101').resolve()
FFMPEG=ROOT/'../../work/video-comparison-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'

def run(args):return subprocess.run([str(FFMPEG),'-hide_banner',*args],capture_output=True,check=True,timeout=120)
def review(attempt='2'):
    if attempt not in ('1','2','3','4','5','6'):raise ValueError('ATTEMPT_INVALID')
    folder=WORK/('lightwan-attempt'+attempt);r=json.loads((folder/'result.json').read_text())
    video=folder/'candidate-native.mp4';data=video.read_bytes()
    assert hashlib.sha256(data).hexdigest()==r['sha256']
    p=json.loads((WORK/'lightwan-comparison-plan.json').read_text())
    assert r['referenceSHA256']==p['shared']['imageSHA256']
    assert r['promptSHA256']==hashlib.sha256(p['shared']['prompt'].encode()).hexdigest()
    checked=run(['-v','error','-i',str(video),'-map','0:v:0','-an','-progress','pipe:1','-f','null','-'])
    frames=int(re.findall(rb'frame=(\d+)',checked.stdout)[-1]);assert frames==81
    timeline=folder/'candidate-5s.mp4'
    if not timeline.exists():run(['-v','error','-n','-i',str(video),'-t','5','-an','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(timeline)])
    for name,inputfile in [('original',WORK/'01-clock-native.mp4'),('accelerated',video)]:
        contact=folder/(name+'-contact.png')
        if not contact.exists():run(['-v','error','-n','-i',str(inputfile),'-vf','fps=2,scale=180:320,tile=5x2','-frames:v','1',str(contact)])
    side=folder/'comparison-original-left-accelerated-right.mp4'
    if not side.exists():run(['-v','error','-n','-i',str(WORK/'01-clock-native.mp4'),'-i',str(video),'-filter_complex','[0:v]scale=360:640,setsar=1[a];[1:v]scale=360:640,setsar=1[b];[a][b]hstack=inputs=2[v]','-map','[v]','-an','-t','5','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(side)])
    report={'decodedFrames':frames,'originalLoadSeconds':47.047844823,'originalPipelineSeconds':1719.344514823,'acceleratedLoadSeconds':r.get('loadSeconds'),'acceleratedPipelineSeconds':r.get('pipelineSeconds'),'sameReferenceAndPromptVerified':True,'candidateSHA256':r['sha256'],'qualityCertified':False,'media':{'native':str(video),'timeline':str(timeline),'comparison':str(side)}}
    (folder/'media-review.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':review(sys.argv[1] if len(sys.argv)>1 else '2')
