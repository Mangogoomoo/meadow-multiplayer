"""Build original hand-pixelled Meadow world, object atlas and shared collision layout.
Run: python tools/build_art.py (requires pillow, numpy, scipy for authoring only).
The deployed game uses static assets and no Python dependencies.
"""
from PIL import Image, ImageDraw
import numpy as np
from scipy.ndimage import gaussian_filter, distance_transform_edt, maximum_filter
import random, math, json, os
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'public','assets');os.makedirs(OUT,exist_ok=True)
W,H=3840,2560; S=2; w,h=W//S,H//S
rng=np.random.default_rng(2091); rand=random.Random(2091)
Y,X=np.mgrid[0:h,0:w]; wx=X*2; wy=Y*2

def ngrid(step,scale=1):
    a=rng.random((max(2,h//step+2),max(2,w//step+2)))
    im=Image.fromarray(np.uint8(a*255),'L').resize((w,h),Image.Resampling.BILINEAR)
    return (np.asarray(im).astype(np.float32)/255-.5)*scale
noise=ngrid(120,1)+ngrid(42,.6)+ngrid(11,.22)
detail=ngrid(9,1)+ngrid(3,.35)

# A naturally edged coastline and two storybook ponds, nothing uses square terrain tiles.
coast=195 + 38*np.sin(wy/167)+22*np.sin(wy/73)+14*np.sin(wy/27)
water=(wx < coast + 26*noise)
water |= (((wx-2140)/(340+30*np.sin(wy/60)))**2+((wy-420)/270)**2 < 1+noise*.12)
water |= (((wx-3090)/410)**2+((wy-2150)/255)**2<1+noise*.15)
# Creek from highland lake through a reed basin.
creek=2210+155*np.sin(wy/290)+30*np.sin(wy/67)
water |= (wy>480)&(wy<2000)&(abs(wx-creek)<(28+7*np.sin(wy/41)+19*noise))
# Irregular northern escarpment + lower east stony ridge.
cliff=(wy < 126 + 56*np.sin(wx/260)+27*np.sin(wx/75)+38*noise) & (wx>600) & (wx<3650)
cliff|=((wx-3265)/560)**2+((wy-1290)/320)**2<1+noise*.05
# A playable ring high atop a plateau.
BOSS=(3260,710)
ruin=(((wx-BOSS[0])/260)**2+((wy-BOSS[1])/215)**2<1+noise*.07)
cliff &= ~ruin
water &= ~ruin

# Curved story paths. Drawn as organic brush strokes rather than cells.
def catmull(points,step=9):
    pts=[points[0]]+points+[points[-1]]
    out=[]
    for i in range(1,len(pts)-2):
        a,b,c,d=pts[i-1:i+3]
        count=max(4,int(math.dist(b,c)/step))
        for j in range(count):
            t=j/count;t2=t*t;t3=t2*t
            out.append((.5*((2*b[0])+(-a[0]+c[0])*t+(2*a[0]-5*b[0]+4*c[0]-d[0])*t2+(-a[0]+3*b[0]-3*c[0]+d[0])*t3),.5*((2*b[1])+(-a[1]+c[1])*t+(2*a[1]-5*b[1]+4*c[1]-d[1])*t2+(-a[1]+3*b[1]-3*c[1]+d[1])*t3)))
    return out+[points[-1]]
paths=[
  [(470,1370),(715,1350),(1010,1220),(1300,970),(1660,960),(1880,1160),(2095,1100),(2490,935),(2820,800),(3260,710)],
  [(1150,1110),(1120,1490),(1340,1790),(1670,1920),(2040,2130)],
  [(1880,1160),(1790,790),(1620,530),(1390,350)],
  [(2500,935),(2740,1250),(2770,1550),(2960,1910),(3090,2170)],
  [(715,1350),(700,1660),(560,1850),(430,2050)],
  [(1670,1920),(2030,1580),(2480,1530)]
]
roadimage=Image.new('L',(w,h));rd=ImageDraw.Draw(roadimage)
for i,points in enumerate(paths):
    pts=catmull(points)
    for j,(px,py) in enumerate(pts):
        r=(39 if i==0 else 29)+3*math.sin(j*.3)+2*math.sin(j*1.1)
        cx,cy=px/2,py/2
        rd.ellipse((int(cx-r/2),int(cy-r/2),int(cx+r/2),int(cy+r/2)),fill=255)
# Plaza and ritual ground, still irregular shapes.
rd.ellipse((565/2,1145/2,900/2,1535/2),fill=255)
road=np.asarray(roadimage)>10
road |= ruin
# Water always wins except bridge pass-through between path and creek. Bridges are walkable.
bridge=(wx>2170)&(wx<2305)&(wy>1060)&(wy<1155)
water &= ~bridge
cliff &= ~road
# Soil around footpaths and beach near coast
shore=distance_transform_edt(~water)
roadnear=distance_transform_edt(~road)

kind=np.zeros((h,w),np.uint8) # grass 0, road 1, water 2, cliff 3, ruin 4
kind[road]=1;kind[cliff]=3;kind[water]=2;kind[ruin]=4
# Map is drawn at 2x logical scale then NEAREST to avoid texture filtering.
palette={
0: np.array([[76,131,77],[84,142,79],[94,153,82],[103,161,86],[72,125,76],[113,166,91]],dtype=np.uint8),
1: np.array([[176,134,89],[194,151,103],[207,167,117],[216,180,130],[185,144,100],[224,185,139]],dtype=np.uint8),
2: np.array([[38,115,139],[42,126,151],[51,143,163],[57,154,174],[35,104,131],[68,159,178]],dtype=np.uint8),
3: np.array([[99,79,70],[120,92,72],[137,103,78],[151,113,83],[111,80,65],[153,117,85]],dtype=np.uint8),
4: np.array([[102,119,110],[119,132,116],[127,138,121],[140,145,124],[105,124,109],[137,143,129]],dtype=np.uint8)}
levels=np.clip(((noise*.54+detail*.14+.5)*6).astype('int32'),0,5)
arr=np.zeros((h,w,3),dtype=np.uint8)
for k,p in palette.items():
    mask=kind==k
    arr[mask]=p[levels[mask]]
# lush shores, earth edging and road border; masks use real pixel distances, not grid limits.
shore_band=(kind==0)&(shore<19)&(shore>0)
arr[shore_band]=np.array([195,177,113],dtype=np.uint8)
sand_edge=(kind==0)&(shore<30)&(shore>=19)
arr[sand_edge]=np.array([154,164,98],dtype=np.uint8)
roadedge=(kind==0)&(roadnear<9)
arr[roadedge]=np.array([115,137,76],dtype=np.uint8)
wateredge=(kind==2)&(distance_transform_edt(water)<15)
arr[wateredge]=np.array([70,159,171],dtype=np.uint8)
base=Image.fromarray(arr,'RGB').convert('RGBA');d=ImageDraw.Draw(base,'RGBA')
# Paths and environmental texture: irregular clusters, loose cobbles, wildflowers.
for i in range(37000):
    x=rand.randrange(w); y=rand.randrange(h);typ=kind[y,x]
    if typ==0:
        if rand.random()<.39:
            col=rand.choice(['#4c8552','#356b4d','#9bb46c','#78a05b','#bfd27b'])
            d.line((x,y+2,x+1,y-2),fill=col,width=1);d.line((x+2,y+2,x+3,y),fill=col,width=1)
        elif rand.random()<.095:
            c=rand.choice(['#ffe2b5','#f8bac0','#fdf4d8','#dfc9f5','#bad6ef'])
            d.rectangle((x,y,x+2,y+2),fill=c)
            d.point((x+1,y+1),fill='#e6b859')
        elif rand.random()<.09:
            d.ellipse((x,y,x+2,y+1),fill='#92a778')
    elif typ==1:
        col=rand.choice(['#aa8359','#e9c591','#bc976c','#f0d4a5'])
        d.ellipse((x,y,x+rand.randint(1,4),y+rand.randint(1,2)),fill=col)
    elif typ==2:
        if rand.random()<.4:
            col=rand.choice(['#88d7cc','#b7ece0','#4ca6b8','#2c819c'])
            d.line((x,y,x+rand.randint(4,10),y),fill=col,width=1)
    elif typ==3:
        d.line((x,y,x+rand.randint(1,5),y-rand.randint(1,3)),fill=rand.choice(['#b59b78','#715747','#a47d60']),width=1)
    else:
        d.line((x,y,x+rand.randint(2,7),y),fill=rand.choice(['#8f9a7d','#617a6e','#c5bea0']),width=1)
# Natural stone terraces surrounding boss arena and fragmented radial runes.
for i in range(25):
    angle=i*math.tau/25;radius=105+18*math.sin(i*7)
    px=(BOSS[0]+math.cos(angle)*radius)/2;py=(BOSS[1]+math.sin(angle)*radius)/2
    d.ellipse((px-8,py-4,px+8,py+5),fill='#7f9082',outline='#556b63',width=2)
for r in [78,146,200]:
    cx,cy=BOSS[0]/2,BOSS[1]/2
    d.arc((cx-r/2,cy-r/2,cx+r/2,cy+r/2),5,355,fill='#92aa91',width=3)
# Shore foam segments & bubbling stream
for i in range(1800):
    x=rand.randrange(5,w-5);y=rand.randrange(5,h-5)
    if kind[y,x]==2 and 0<distance_transform_edt(water)[y,x]<12 and rand.random()<.3:
        d.line((x,y,x+rand.randint(2,7),y),fill='#d6eee1',width=1)
# Handplaced wooden bridges over the creek.
for x,y,ww,hh in [(2220,1090,120,77)]:
    xx,yy=x/2,y/2
    d.rectangle((xx-ww/4,yy-hh/4,xx+ww/4,yy+hh/4),fill='#614535',outline='#3e392f',width=3)
    for j in range(-3,4):
        xx2=xx+j*8; d.line((xx2,yy-hh/4,xx2,yy+hh/4),fill='#b88d59',width=6)
    d.line((xx-ww/4,yy-hh/4,xx+ww/4,yy-hh/4),fill='#d1aa69',width=3)
    d.line((xx-ww/4,yy+hh/4,xx+ww/4,yy+hh/4),fill='#4a382e',width=4)
base.resize((W,H),Image.Resampling.NEAREST).convert('RGB').save(os.path.join(OUT,'world.png'),optimize=True)

# Prop placement: objects draw at their actual feet, sorted together with actors.
props=[]
def add(typ,x,y,variant=0):props.append([int(x),int(y),typ,int(variant)])
major=[('cottage',590,1168),('windmill',1340,400),('barn',2480,1500),('shrine',1950,1790),('obelisk',3160,575),('obelisk',3385,590),('obelisk',3250,850),('campfire',930,1515)]
for typ,x,y in major:add(typ,x,y)
# Blended thematic forest clusters; sprite positions are not arranged on grid.
for _ in range(285):
    x=rand.randint(280,W-90); y=rand.randint(130,H-65)
    ix=min(w-1,x//2);iy=min(h-1,y//2)
    if kind[iy,ix] in (1,2,3,4) or roadnear[iy,ix]<34:continue
    if math.hypot(x-715,y-1340)<290 or math.hypot(x-BOSS[0],y-BOSS[1])<320:continue
    if any(math.hypot(x-a,y-b)<r for a,b,r in [(590,1168,170),(1340,400,150),(2480,1500,165),(1950,1790,110)]):continue
    grove = math.sin(x/310)+math.cos(y/265)>-.6
    if not grove and rand.random()<.64:continue
    add(rand.choice(['oak','oak','oak','pine','pine','willow','blossom']),x,y,rand.randrange(3))
# Scenery with frequent visual variation, nonblocking.
for _ in range(530):
    x=rand.randint(260,W-80);y=rand.randint(140,H-65)
    ix=x//2;iy=y//2
    if kind[iy,ix]!=0 or roadnear[iy,ix]<8 or math.hypot(x-BOSS[0],y-BOSS[1])<240: continue
    typ=rand.choices(['bush','bush','stone','stump','flowerbed','mushrooms','log'],[26,12,21,5,22,9,5])[0]
    add(typ,x,y,rand.randrange(4))
# Things telling a recognizable story at the spawn, farm and ruins.
for i in range(9):add('fence',420+i*42,1126,i%2)
for i in range(7):add('fence',2520+i*42,1602,i%2)
for x,y in [(455,1260),(750,1170),(1840,1630),(2415,1390),(3050,810),(1380,520)]:add('sign',x,y)
for x,y in [(912,1408),(977,1610),(1480,1780),(2100,1600),(2710,820),(2860,740)]:add('lantern',x,y)
for i in range(18):
    ang=math.tau*i/18
    add('pillar' if i%3==0 else 'stone',BOSS[0]+math.cos(ang)*247,BOSS[1]+math.sin(ang)*210,i%4)
# Collision: preserve broad walkable grass; only water/cliff and trunks/buildings block.
# A few buildings/trunks occupy their foot cells, not their entire canopy.
collision=np.zeros((80,120),np.uint8)
for ty in range(80):
    for tx in range(120):
        area=kind[ty*16+4:ty*16+12,tx*16+4:tx*16+12]
        # Areas near terrain edges remain playable if primarily grass/path.
        waterfrac=(area==2).mean(); clifffrac=(area==3).mean()
        if waterfrac>.48:collision[ty,tx]=2
        elif clifffrac>.66:collision[ty,tx]=3
        elif (area==4).mean()>.5:collision[ty,tx]=4
        elif (area==1).mean()>.42:collision[ty,tx]=1
for x,y,typ,v in props:
    if typ in ('oak','pine','willow','blossom','cottage','windmill','barn','obelisk','pillar'):
        tx,ty=x//32,y//32
        if 0<=tx<120 and 0<=ty<80: collision[ty,tx]=5
# ensure landmarks and player/boss exact center remain accessible
for cx,cy,rad in [(715,1340,80),(BOSS[0],BOSS[1],100)]:
    for yy in range(max(0,int((cy-rad)/32)),min(80,int((cy+rad)/32)+1)):
        for xx in range(max(0,int((cx-rad)/32)),min(120,int((cx+rad)/32)+1)):
            if math.hypot(xx*32+16-cx,yy*32+16-cy)<rad:collision[yy,xx]=4 if (cx,cy)==BOSS else 1
# Invariant: all 120x80 cells mapped 1:1 in both client and server.
char='gdwc rt'.replace(' ','') # g,d,w,c,r,t
rows=[''.join(char[v] for v in collision[j]) for j in range(80)]
layout={'width':W,'height':H,'tile':32,'spawn':{'x':715,'y':1340},'boss':{'x':BOSS[0],'y':BOSS[1]},'rows':rows,'props':props}
with open(os.path.join(ROOT,'public','world-data.js'),'w') as f:
    f.write('// GENERATED: tools/build_art.py. Same collision grid on client & authoritative server.\n')
    f.write('(function(root,factory){const world=factory();if(typeof module===\'object\'&&module.exports)module.exports=world;else root.MEADOW_WORLD=world;})(typeof globalThis!==\'undefined\'?globalThis:this,function(){return ')
    json.dump(layout,f,separators=(',',':'))
    f.write(';});\n')
print('Background and world data generated:',len(props),'props; blocked',np.count_nonzero((collision==2)|(collision==3)|(collision==5)),'cells')
# ------------------------- original pixel sprite atlas ------------------------
# Sprites are authored pixel-by-pixel using shape clusters and 2x nearest scaling.
# They are saved as a real transparent PNG atlas, not runtime canvas primitives.
class Pixel:
    def __init__(self,w,h):
        self.w=w;self.h=h;self.im=Image.new('RGBA',(w,h));self.d=ImageDraw.Draw(self.im)
    def rect(self,x0,y0,x1,y1,c):self.d.rectangle((int(x0),int(y0),int(x1),int(y1)),fill=c)
    def ell(self,x0,y0,x1,y1,c):self.d.ellipse((int(x0),int(y0),int(x1),int(y1)),fill=c)
    def poly(self,pts,c):self.d.polygon(pts,fill=c)
    def line(self,pts,c,width=1):self.d.line(pts,fill=c,width=width)
    def scaled(self):return self.im.resize((self.w*2,self.h*2),Image.Resampling.NEAREST)

DARK='#2c2936';DEEPL='#223735';SKIN='#eeb994';SKIND='#bf7c68';GOLD='#f3cc78';LIGHT='#fcf2d4'

def sprite_tree(typ,variant):
    q=Pixel(64,70);rr=random.Random(1000+variant*19+sum(map(ord,typ)))
    if typ=='pine':
        q.rect(29,42,37,68,'#443a33');q.rect(32,42,35,68,'#866040')
        for yi,wi in [(7,17),(18,24),(29,28),(40,31)]:
            q.poly([(32,yi-7),(32-wi,yi+19),(32+wi,yi+19)],DEEPL)
            q.poly([(32,yi-4),(32-wi+5,yi+14),(32+wi-9,yi+15)],['#32705b','#438765','#316d58'][variant%3])
            for j in range(5):
                xx=rr.randint(32-wi+10,32+wi-12);yy=yi+rr.randint(4,15)
                q.rect(xx,yy,xx+rr.randint(2,5),yy+1,'#82b37b')
    else:
        q.rect(27,33,37,68,DARK);q.rect(29,34,35,67,'#80563d');q.rect(32,39,34,60,'#af7b4d')
        q.line([(31,53),(20,39)],'#5f4537',4);q.line([(33,50),(43,35)],'#5f4537',4)
        if typ=='blossom':colors=['#9e4d7d','#d987ad','#eeb2c6','#ffd9cb','#fff0d7']
        elif typ=='willow': colors=['#1d504e','#337c68','#499c78','#80b58b','#a5ca8d']
        else:colors=['#274c4b','#326657','#447e58','#5b9a63','#9dbd75']
        for cx,cy,rx,ry in [(19,28,18,16),(42,27,19,17),(32,14,20,16),(15,42,17,14),(47,42,18,14),(33,35,25,19)]:
            q.ell(cx-rx-2,cy-ry+2,cx+rx+2,cy+ry+2,colors[0]);q.ell(cx-rx,cy-ry,cx+rx,cy+ry,colors[1]);q.ell(cx-rx+4,cy-ry+1,cx+rx-3,cy+ry-5,colors[2])
        for j in range(70):
            xx=rr.randint(9,55); yy=rr.randint(5,46)
            if q.im.getpixel((xx,yy))[3]:
                q.rect(xx,yy,xx+rr.choice([1,2,3]),yy+rr.choice([0,1,2]),colors[rr.choice([2,3,3,4])])
        if typ=='willow':
            for xx in [12,18,24,40,46,53]:
                q.line([(xx,25),(xx-2,49+rr.randint(2,13))],'#4c9b72',2)
    return q.scaled()

def prop_sprite(typ,variant):
    if typ in ('oak','pine','willow','blossom'):return sprite_tree(typ,variant)
    if typ=='cottage':
        q=Pixel(116,104)
        q.ell(8,88,108,102,'#415940');q.rect(18,46,103,96,'#4a3437');q.rect(23,48,100,95,'#cfad78')
        for xx in range(29,100,16):
            q.line([(xx,50),(xx,94)],'#a67b55',1)
        q.poly([(7,51),(53,7),(113,49),(106,62),(52,26),(16,61)],DARK)
        q.poly([(13,48),(54,13),(109,49),(103,54),(54,22),(18,55)],'#9d4f40')
        for j in range(7):
            yy=30+j*3
            q.line([(21-j*2,yy+19),(54,yy-16),(105-j*1,yy+17)],'#bb6d51',2)
        q.rect(55,64,78,96,DARK);q.rect(60,68,75,95,'#754739');q.rect(65,69,69,95,'#a56b48');q.ell(71,82,73,85,GOLD)
        q.rect(25,62,45,82,DARK);q.rect(28,65,42,79,'#67bec4');q.line([(35,65),(35,79)],'#eee6a0',2);q.line([(28,72),(42,72)],'#eee6a0',2)
        q.rect(89,36,98,56,DARK);q.rect(90,36,96,49,'#80665b');q.rect(87,34,100,38,'#e1c497')
        for x in range(23,98,12):q.rect(x,92,x+5,96,'#70513d')
    elif typ=='windmill':
        q=Pixel(94,117);q.ell(8,103,87,113,'#58684f');q.poly([(27,108),(39,38),(62,38),(74,108)],DARK);q.poly([(31,105),(42,42),(60,42),(70,105)],'#c8b697')
        for j in range(7):q.line([(34+j,100),(44+j//2,47)],'#ab977e')
        q.poly([(31,41),(49,17),(71,42)],DARK);q.poly([(36,39),(50,23),(65,39)],'#ba6e4b')
        q.rect(45,79,58,108,DARK);q.rect(48,83,56,106,'#74533d')
        q.ell(44,40,56,52,'#614c47')
        q.rect(49,6,52,80,'#eee3c9');q.rect(14,44,86,49,'#eee3c9')
        q.poly([(44,40),(19,10),(24,7),(53,39)],'#8b6b50');q.poly([(56,51),(83,80),(80,85),(49,54)],'#8b6b50')
        q.ell(44,40,57,53,DARK);q.ell(48,44,53,49,GOLD)
    elif typ=='barn':
        q=Pixel(127,99);q.ell(12,86,116,96,'#536e47');q.rect(13,40,114,92,DARK);q.rect(17,42,110,90,'#b46448')
        for x in range(20,112,10):q.line([(x,44),(x,87)],'#cc7f51',2)
        q.poly([(5,46),(34,8),(106,8),(122,46)],DARK);q.poly([(10,43),(36,12),(102,12),(116,43)],'#7d5549')
        for y in range(17,41,6):q.line([(28-y//4,y),(106+y//6,y)],'#ab7d60',3)
        q.rect(48,53,81,92,DARK);q.rect(52,58,77,90,'#815c49');q.line([(64,58),(64,89)],'#cf9a64',2);q.line([(52,58),(78,89)],'#c79666',2)
        q.rect(22,51,39,68,DARK);q.rect(25,53,36,65,'#a8cb9c');q.rect(90,51,106,68,DARK);q.rect(93,53,103,65,'#a8cb9c')
    elif typ=='shrine':
        q=Pixel(64,85);q.ell(5,73,58,83,'#405748');q.rect(11,72,55,78,DARK);q.rect(14,70,52,74,'#a6a997');q.rect(18,41,48,71,DARK)
        q.rect(21,44,46,69,'#829785');q.rect(25,48,42,65,'#45656e');q.poly([(33,35),(41,51),(32,59),(24,49)],'#82d9bf')
        q.poly([(11,45),(29,15),(37,15),(55,45)],DARK);q.poly([(17,42),(30,21),(36,21),(48,42)],'#acac90')
        q.ell(27,48,38,60,'#d8e3a5');q.ell(29,48,35,56,'#a6f4cf')
        q.rect(8,40,13,73,'#667d72');q.rect(52,40,57,73,'#667d72')
    elif typ in ('obelisk','pillar'):
        q=Pixel(39,65 if typ=='obelisk' else 49)
        h=q.h
        q.ell(3,h-12,36,h-3,'#495e57');q.poly([(8,h-5),(10,20),(20,4),(29,20),(33,h-5)],DARK)
        q.poly([(12,h-9),(14,21),(21,10),(25,23),(28,h-9)],'#8f9e97')
        q.poly([(21,10),(25,23),(28,h-9),(22,h-11)],'#596b68')
        q.poly([(18,31),(23,36),(19,44),(14,38)],'#90d7ae')
        q.line([(16,55),(23,49),(20,45)],'#bdc9ad',2)
        if typ=='pillar':q.rect(9,8,29,19,'#74877d');q.rect(6,6,33,11,'#4a5b54')
    elif typ=='campfire':
        q=Pixel(37,38);q.ell(3,22,34,35,'#4d543a');q.ell(7,21,30,30,'#9d8865')
        q.line([(8,27),(26,29)],'#594331',5);q.line([(26,25),(11,32)],'#885f38',4)
        q.poly([(19,1),(29,22),(20,26),(12,17)],'#b54a30');q.poly([(19,5),(26,20),(20,24),(16,18)],'#ffad3d');q.poly([(19,12),(22,21),(18,23),(16,20)],'#fff3a4')
    elif typ=='fence':
        q=Pixel(25,26);q.rect(1,11,23,15,DARK);q.rect(1,20,23,24,DARK);q.rect(2,12,23,14,'#be915a');q.rect(2,21,23,23,'#be915a')
        for x in [3,18]:q.rect(x,4,x+5,25,DARK);q.rect(x+1,5,x+4,23,'#a66c45');q.rect(x+2,5,x+3,9,'#dfb176')
    elif typ=='lantern':
        q=Pixel(24,49);q.ell(4,44,21,48,'#3c4f3d');q.rect(10,17,13,45,DARK);q.rect(11,19,12,44,'#806a4c')
        q.rect(5,7,19,23,DARK);q.rect(8,10,16,20,'#f4ca77');q.rect(10,12,14,18,'#fff1ae')
        q.rect(3,8,21,10,'#574c43');q.poly([(6,7),(12,2),(18,7)],DARK)
    elif typ=='sign':
        q=Pixel(39,47);q.ell(6,41,33,46,'#425443');q.rect(17,20,21,45,DARK);q.rect(18,22,20,44,'#ab8657')
        q.poly([(3,12),(31,12),(36,17),(30,29),(3,29)],DARK);q.poly([(5,14),(30,14),(33,18),(29,26),(6,26)],'#b98550')
        q.line([(10,19),(26,19)],'#eac589',2);q.rect(12,23,21,23,'#765139')
    elif typ=='stone':
        q=Pixel(30,20);q.ell(3,13,28,19,'#486354');q.poly([(2,14),(7,5),(21,2),(29,9),(28,15),(11,18)],DARK)
        q.poly([(6,13),(9,6),(20,5),(26,10),(23,14)],'#8e9c94');q.poly([(9,7),(19,5),(15,11),(6,13)],'#b6bdb0');q.line([(19,10),(23,15)],'#566d68',2)
    elif typ=='bush':
        q=Pixel(37,25);q.ell(1,13,35,24,DARK)
        for cx,cy,rr in [(10,14,9),(20,8,11),(28,14,8)]:
            q.ell(cx-rr,cy-rr,cx+rr,cy+rr,'#255748');q.ell(cx-rr+2,cy-rr+1,cx+rr-2,cy+rr-3,'#43805b')
        for cx,cy in [(8,9),(17,5),(26,10),(23,17)]:q.rect(cx,cy,cx+2,cy+2,'#8bbb76')
        if variant%2:q.rect(24,5,26,7,'#f8b6aa')
    elif typ=='flowerbed':
        q=Pixel(30,19)
        for x,y in [(6,11),(12,5),(19,8),(24,12)]:
            q.line([(x,17),(x,y+2)],'#34734f',2)
            c=['#f6dba2','#f7a8b9','#c5b8ef','#fff4dc'][variant%4]
            for dx,dy in [(-2,0),(2,0),(0,-2),(0,2)]:q.rect(x+dx,y+dy,x+dx+2,y+dy+2,c)
            q.rect(x,y,x+1,y+1,'#cf9352')
    elif typ=='mushrooms':
        q=Pixel(31,20)
        for x,y,sc in [(7,6,1),(20,3,2)]:
            q.rect(x,y+6,x+3,y+14,'#e0cdac');q.ell(x-6,y-1,x+8,y+9,'#a65b5c');q.rect(x-3,y+2,x,y+3,'#f6debf');q.rect(x+3,y+1,x+4,y+3,'#f6debf')
    elif typ=='stump':
        q=Pixel(29,23);q.ell(1,15,27,22,'#495940');q.rect(6,7,22,20,DARK);q.rect(8,8,21,19,'#9d6745');q.ell(4,4,24,12,DARK);q.ell(7,5,22,10,'#d0a36c');q.ell(11,6,18,9,'#a77953')
    elif typ=='log':
        q=Pixel(35,18);q.ell(0,6,34,17,'#365243');q.poly([(2,4),(23,2),(32,6),(32,15),(7,16)],DARK);q.poly([(4,6),(24,4),(29,8),(28,13),(5,13)],'#926946');q.ell(21,4,32,14,'#d3a775');q.ell(24,6,29,12,'#8e603f')
    else:raise ValueError(typ)
    return q.scaled()

def char_sprite(direction,frame):
    q=Pixel(31,41);step=[0,2,0,-2][frame];sway=[0,1,0,-1][frame]
    # The new wanderer: teal cloak, gold scarf, auburn swept hair, bronze boots.
    q.ell(5,35,25,39,'#243f3d')
    q.rect(9,29+step,13,38+step,DARK);q.rect(17,29-step,21,38-step,DARK)
    q.rect(10,30+step,13,36+step,'#8c583e');q.rect(18,30-step,21,36-step,'#a56d48')
    q.poly([(8,19),(23,18),(26,33),(18,37),(7,32)],DARK)
    q.poly([(10,19),(22,20),(24,32),(17,34),(10,30)],'#24716e')
    q.rect(10,23,21,25,'#d2aa65');q.rect(14,19,17,33,'#65ae97')
    if direction=='up':
        q.poly([(8,13),(12,7),(21,8),(25,17),(21,21),(10,21)],DARK)
        q.poly([(10,12),(14,9),(21,10),(23,18),(11,18)],'#935d43')
        q.rect(12,12,19,15,'#b67c52')
        q.line([(8,21),(7,27+sway)],'#e1bc8c',3);q.line([(24,21),(25,28-sway)],'#e1bc8c',3)
    else:
        q.rect(9,7,23,22,DARK);q.rect(11,9,21,19,SKIN)
        q.rect(9,5,22,10,'#704738');q.rect(11,3,19,7,'#a56c42');q.rect(18,5,24,11,'#8d523c')
        if direction=='down':
            q.rect(12,14,14,16,DEEPL);q.rect(19,14,21,16,DEEPL)
            q.rect(15,18,17,19,SKIND)
        elif direction=='left':
            q.rect(10,13,12,16,DEEPL)
            q.rect(8,16,10,19,SKIND)
        else:
            q.rect(20,13,22,16,DEEPL)
            q.rect(22,16,24,19,SKIND)
        q.rect(7,21+sway,10,29+sway,'#e2a680');q.rect(23,21-sway,26,29-sway,'#e2a680')
    # shoulder mantle and belt pouch
    q.rect(8,19,10,23,'#d5ad62');q.rect(21,19,24,22,'#d5ad62');q.rect(18,25,23,29,'#8e563d');q.rect(19,26,21,27,GOLD)
    if direction=='up':q.rect(13,21,17,24,'#d4ae70')
    return q.scaled()

def mob_sprite(typ,frame):
    bounce=[0,-1,-2,-1][frame]
    if typ=='rat': # Completely new red foxlike thornbeast, not the old gray oval rat.
        q=Pixel(37,36)
        q.ell(5,25,32,33,'#3f3d41');q.poly([(6,22),(2,8),(13,13),(17,18),(24,12),(32,8),(31,24)],DARK)
        q.poly([(8,19+bounce),(7,10+bounce),(17,17+bounce),(25,10+bounce),(30,21+bounce)],'#bd5f4b')
        q.ell(9,15+bounce,29,28+bounce,'#c77757');q.ell(15,21+bounce,25,29+bounce,'#eac398')
        q.rect(11,17+bounce,14,19+bounce,'#e9d77e');q.rect(24,17+bounce,27,19+bounce,'#e9d77e')
        q.rect(12,18+bounce,13,19+bounce,DARK);q.rect(24,18+bounce,25,19+bounce,DARK)
        q.poly([(3,20),(0,16),(6,14),(12,21)],'#8a4a48');q.poly([(31,22),(36,15),(34,29),(28,28)],'#835747')
        q.rect(5,26+bounce,10,32+bounce,DARK);q.rect(26,26+bounce,31,32+bounce,DARK)
        q.rect(7,28+bounce,9,30+bounce,'#985e4c')
    elif typ=='bat': # Indigo lantern moth rather than existing simple triangle bat
        q=Pixel(44,42);b=bounce
        q.poly([(19,20+b),(7,12+b),(0,17+b),(8,29+b),(16,26+b)],DARK)
        q.poly([(25,20+b),(37,12+b),(43,17+b),(35,29+b),(27,26+b)],DARK)
        q.poly([(17,20+b),(5,15+b),(10,26+b),(20,25+b)],'#53658d')
        q.poly([(27,20+b),(39,15+b),(34,26+b),(24,25+b)],'#53658d')
        q.rect(12,18+b,15,22+b,'#c691d0');q.rect(29,18+b,32,22+b,'#c691d0')
        q.ell(13,10+b,31,32+b,DARK);q.ell(16,12+b,28,29+b,'#6877a7')
        q.ell(19,15+b,26,24+b,'#b5c2d9');q.rect(18,20+b,20,22+b,'#fde1a4');q.rect(25,20+b,27,22+b,'#fde1a4')
        q.rect(18,30+b,20,35+b,'#596a8d');q.rect(25,30+b,27,35+b,'#596a8d')
        q.poly([(16,15+b),(12,4+b),(23,10+b),(28,4+b),(29,16+b)],'#495479')
    elif typ=='baphometjr':
        q=Pixel(42,49);b=bounce
        q.poly([(5,36+b),(9,22+b),(23,17+b),(34,25+b),(39,37+b),(30,43+b),(12,43+b)],DARK)
        q.poly([(10,35+b),(13,24+b),(27,21+b),(33,33+b),(28,40+b),(12,39+b)],'#538d7e')
        q.poly([(13,23+b),(7,7+b),(21,14+b),(29,5+b),(34,23+b)],'#445d52')
        q.poly([(13,21+b),(12,12+b),(23,17+b),(29,11+b),(30,23+b)],'#a7bb85')
        q.rect(15,24+b,18,27+b,'#fbd184');q.rect(25,24+b,28,27+b,'#fbd184')
        q.rect(15,25+b,16,27+b,DARK);q.rect(26,25+b,27,27+b,DARK)
        q.ell(19,29+b,23,34+b,'#3c5b55')
    else: # Boss now a giant ancient antlered forest knight / corrupted stone sentinel
        q=Pixel(89,104);b=bounce
        q.ell(11,90,79,102,'#3b4a42')
        # massive branching antlers
        for sg in [-1,1]:
            cx=45
            q.line([(cx+sg*16,42+b),(cx+sg*32,20+b),(cx+sg*39,4+b)],DARK,9)
            q.line([(cx+sg*32,23+b),(cx+sg*27,3+b)],DARK,6)
            q.line([(cx+sg*32,22+b),(cx+sg*43,16+b)],'#a99164',5)
        q.rect(20,62+b,34,95+b,DARK);q.rect(53,62+b,67,95+b,DARK)
        q.rect(23,67+b,32,91+b,'#586453');q.rect(55,67+b,64,91+b,'#586453')
        q.poly([(9,56+b),(20,40+b),(66,40+b),(80,55+b),(72,79+b),(15,79+b)],DARK)
        q.poly([(15,56+b),(23,44+b),(63,44+b),(74,59+b),(68,75+b),(21,75+b)],'#647b63')
        q.poly([(18,55+b),(28,47+b),(62,47+b),(70,58+b),(58,70+b),(29,70+b)],'#789679')
        q.poly([(15,46+b),(9,25+b),(25,30+b),(34,46+b)],'#3e554e');q.poly([(73,45+b),(79,25+b),(62,30+b),(55,45+b)],'#3e554e')
        q.poly([(22,46+b),(24,20+b),(43,13+b),(65,20+b),(67,46+b),(47,60+b)],DARK)
        q.poly([(26,43+b),(29,23+b),(45,16+b),(62,24+b),(64,41+b),(46,52+b)],'#889b80')
        q.poly([(34,36+b),(44,26+b),(56,34+b),(45,46+b)],'#304e53')
        q.rect(31,33+b,38,37+b,'#ecae74');q.rect(52,33+b,59,37+b,'#ecae74')
        q.rect(34,34+b,37,36+b,'#ffecbd');q.rect(52,34+b,55,36+b,'#ffecbd')
        q.poly([(37,49+b),(45,58+b),(54,49+b),(50,62+b),(40,62+b)],'#4c554c')
        # luminous chest runestone
        q.poly([(44,56+b),(54,67+b),(45,82+b),(36,69+b)],'#2d434b')
        q.poly([(44,60+b),(51,69+b),(45,77+b),(40,68+b)],'#a1f5c2')
        q.line([(20,84+b),(15,94+b)],'#b6ab87',4)
        q.line([(70,84+b),(74,94+b)],'#b6ab87',4)
    return q.scaled()

def weapon_sprite():
    q=Pixel(37,16)
    q.poly([(2,7),(9,5),(21,5),(34,8),(21,11),(9,11)],'#293945')
    q.poly([(16,6),(31,8),(16,9)],'#e5eef0')
    q.poly([(10,6),(23,7),(22,8),(10,9)],'#9dcad2')
    q.rect(8,2,11,14,'#e2b46e');q.rect(7,1,10,3,'#fcdda2');q.rect(1,6,8,9,'#7f4e3b');q.rect(1,7,7,8,'#c68e52')
    return q.scaled()

assets={}
for typ in ['oak','pine','willow','blossom']:
    for v in range(3):assets[f'{typ}_{v}']=prop_sprite(typ,v)
for typ in ['cottage','windmill','barn','shrine','obelisk','campfire','fence','lantern','sign','stone','bush','flowerbed','mushrooms','stump','log','pillar']:
    for v in range(4 if typ in ['flowerbed','bush','stone','mushrooms'] else 1):assets[f'{typ}_{v}']=prop_sprite(typ,v)
for di in ['down','left','right','up']:
    for fr in range(4):assets[f'hero_{di}_{fr}']=char_sprite(di,fr)
for typ in ['rat','bat','baphomet','baphometjr']:
    for fr in range(4):assets[f'{typ}_{fr}']=mob_sprite(typ,fr)
assets['sword_0']=weapon_sprite()

# 1024px wide transparent atlas with 2px bleeding-safe gutters.
ATLAS_W=1024; atlas=Image.new('RGBA',(ATLAS_W,2048)); ax=2;ay=2;row_h=0;meta={}
for name,im in assets.items():
    iw,ih=im.size
    if ax+iw+4>ATLAS_W:ax=2;ay+=row_h+4;row_h=0
    atlas.alpha_composite(im,(ax,ay));meta[name]=[ax,ay,iw,ih]
    ax+=iw+4;row_h=max(row_h,ih)
atlas=atlas.crop((0,0,ATLAS_W,ay+row_h+2))
atlas.save(os.path.join(OUT,'atlas.png'),optimize=True)
with open(os.path.join(ROOT,'public','art-data.js'),'w') as f:
    f.write('// GENERATED: actual transparent original sprite frames; source dimensions in pixels.\n')
    f.write('window.MEADOW_ART=')
    json.dump(meta,f,separators=(',',':'))
    f.write(';\n')
print('Sprite atlas generated:',len(assets),'frames;',atlas.size)
