"""Generate original, editable procedural pixel artwork and synchronized world collision data.
Run: python scripts/generate_art.py
"""
from PIL import Image, ImageDraw, ImageFilter
import numpy as np, random, math, json
from pathlib import Path
OUT=Path(__file__).resolve().parents[1]/'public'/'assets'
OUT.mkdir(parents=True,exist_ok=True)
R=random.Random(49032)
CW,CH=120,80
TS=32
W,H=CW*TS,CH*TS
PW,PH=W//2,H//2

# All world features are plotted in continuous world coordinates, not rendered cell-by-cell.
water=Image.new('L',(PW,PH));wd=ImageDraw.Draw(water)
road=Image.new('L',(PW,PH));rd=ImageDraw.Draw(road)
rock=Image.new('L',(PW,PH));cd=ImageDraw.Draw(rock)
arena=Image.new('L',(PW,PH));ad=ImageDraw.Draw(arena)

def ppoints(pts):return [(int(x/2),int(y/2)) for x,y in pts]
def thick_line(draw,pts,width,fill=255,joint='curve'):
    ps=ppoints(pts);draw.line(ps,fill=fill,width=max(1,width//2),joint=joint)
    for x,y in ps:draw.ellipse((x-width/4,y-width/4,x+width/4,y+width/4),fill=fill)

# Forest hills on upper and lower map rims; cut openings into the hills for trails.
rockpoly=[(0,0),(3840,0),(3840,165),(3580,190),(3430,175),(3310,225),(3010,168),(2690,215),(2470,200),(2220,235),(1940,160),(1770,230),(1540,172),(1250,203),(970,180),(750,236),(540,170),(260,240),(0,206)]
cd.polygon(ppoints(rockpoly),fill=255)
cd.polygon(ppoints([(0,2270),(240,2260),(480,2335),(660,2270),(1000,2350),(1290,2302),(1660,2370),(1960,2320),(2280,2385),(2600,2308),(2910,2360),(3220,2292),(3540,2362),(3840,2305),(3840,2560),(0,2560)]),fill=255)
cd.polygon(ppoints([(0,360),(190,383),(280,460),(255,660),(180,750),(0,720)]),fill=255)
cd.polygon(ppoints([(3840,1430),(3700,1500),(3580,1770),(3670,1850),(3840,1840)]),fill=255)

# Broad winding stream, with a tributary, lake and pond.
river=[]
for y in range(-100,H+120,12):
    x=3350 + 130*math.sin(y/290)+47*math.sin(y/98)+30*math.sin(y/620)
    river.append((x,y))
thick_line(wd,river,138)
thick_line(wd,[(2850,350),(2820,470),(2750,600),(2790,725),(2860,800),(2960,870),(3160,930),(3330,970)],82)
wd.ellipse((int(470/2),int(430/2),int(980/2),int(750/2)),fill=255)
wd.ellipse((int(540/2),int(1860/2),int(990/2),int(2220/2)),fill=255)
wd.ellipse((int(2250/2),int(1970/2),int(2730/2),int(2250/2)),fill=255)
# Main dirt trail curves from the start meadow to the boss grounds.
maintrail=[(530,1430),(650,1370),(770,1320),(940,1295),(1100,1350),(1310,1400),(1540,1320),(1750,1250),(2000,1280),(2180,1370),(2390,1280),(2670,1260),(2890,1290),(3210,1300)]
thick_line(rd,maintrail,112)
# Trail branches and side clearings.
thick_line(rd,[(1370,1350),(1440,1510),(1570,1640),(1730,1800),(1940,1890),(2130,1990)],66)
thick_line(rd,[(1760,1260),(1850,1120),(1920,900),(2060,700),(2300,570),(2540,490)],67)
thick_line(rd,[(840,1340),(790,1180),(720,1020),(670,880)],63)
thick_line(rd,[(2540,1270),(2580,1510),(2670,1670),(2850,1810)],60)
# The boss clearing is an uneven ancient stone ring, reached from the main trail.
ad.ellipse((int(2900/2),int(940/2),int(3580/2),int(1630/2)),fill=255)
# The boss ritual arena stands on ancient solid rock, not submerged in the stream.
wd.ellipse((int(2894/2),int(935/2),int(3586/2),int(1635/2)),fill=0)
# Bridges overlay water. They need to remain walkable.
bridges=[]
for y in [640,1910]:
    bx=3350+130*math.sin(y/290)+47*math.sin(y/98)+30*math.sin(y/620)
    bridges.append((round(bx),y))
    rd.rectangle((int((bx-100)/2),int((y-40)/2),int((bx+100)/2),int((y+40)/2)),fill=255)
# carve road/arena out of rocks, allow hillside steps
cd.ellipse((int(565/2),int(1240/2),int(1000/2),int(1560/2)),fill=0)

w=np.asarray(water).copy()>0
r=np.asarray(road).copy()>0
c=np.asarray(rock).copy()>0
a=np.asarray(arena).copy()>0
# Continuous blended pixel terrain texture.
rng=np.random.default_rng(2014)
def coarse_noise(scale):
    small=Image.fromarray(rng.integers(0,256,(max(2,PH//scale),max(2,PW//scale)),dtype=np.uint8))
    return np.asarray(small.resize((PW,PH),Image.Resampling.BILINEAR)).astype(np.float32)/255
n1=coarse_noise(69);n2=coarse_noise(17);n3=coarse_noise(4)
yv,xv=np.indices((PH,PW))
rough=(n1-.5)*26+(n2-.5)*12+(n3-.5)*8
base=np.zeros((PH,PW,3),dtype=np.float32)
base[:,:,0]=88+rough+7*np.sin(xv/90)
base[:,:,1]=171+rough+8*np.sin(yv/130)
base[:,:,2]=83+rough*.69
# rich earth paths
base[r]=[180,143,92];base[r]+=((n2[r]-.5)*24)[:,None]
# lilac dark cracked boss cobblestones
base[a]=[99,99,115];base[a]+=((n2[a]-.5)*24)[:,None]
# hill terracotta
base[c]=[123,82,62];base[c]+=((n1[c]-.5)*33)[:,None]
# blue water with depth variation
base[w]=[56,147,188];base[w]+=((n1[w]-.5)*20)[:,None]
# bridges and ground above water
bridgeMask=r & w
base[bridgeMask]=[168,117,72]
img=Image.fromarray(np.uint8(np.clip(base,0,255)),'RGB')
D=ImageDraw.Draw(img)

# Avoid any 32px boundary guides, draw texture scattered continuously.
for _ in range(11500):
    x=R.randrange(PW);y=R.randrange(PH)
    if w[y,x] and not bridgeMask[y,x]:
        if R.random()<.21:
            t=R.randrange(4,11)
            D.line([(x,y),(x+t,y)],fill=R.choice(['#c5eaff','#72bedf','#99d6f1']),width=1)
        continue
    if c[y,x]:
        if R.random()<.28:
            D.line([(x,y),(x+R.randrange(3,10),y-R.randrange(2,6))],fill=R.choice(['#533d35','#a77b5f','#765041']),width=1)
        continue
    if a[y,x]:
        if R.random()<.25:
            L=R.randint(4,9);D.line([(x,y),(x+L,y-R.randint(1,5)),(x+L+3,y+2)],fill='#565363',width=1)
        continue
    if r[y,x]:
        if R.random()<.18:
            D.rectangle((x,y,x+R.randint(1,3),y+1),fill=R.choice(['#9d7a50','#d2b083','#efd3a4']))
        continue
    col=R.choice(['#438a43','#60a958','#8acb6d','#b4da77','#377d3e'])
    if R.random()<.7:
        D.line([(x,y+3),(x-1,y),(x-2,y+1)],fill=col,width=1)
        D.line([(x,y+3),(x+1,y-2)],fill=col,width=1)
    elif R.random()<.13:
        co=R.choice(['#b4dcff','#ffb3ca','#f5de8e','#f9f3de'])
        D.rectangle((x,y,x+1,y+1),fill=co);D.point((x+2,y),fill='#fbfaf6')

# Broken flagstones and engraved runes within boss arena.
for i in range(220):
    x=R.randrange(int(2900/2),int(3580/2));y=R.randrange(int(940/2),int(1630/2))
    if 0<=x<PW and 0<=y<PH and a[y,x] and R.random()<.18:
        D.line([(x,y),(x+R.randrange(3,9),y+R.randrange(-3,4))],fill='#464653',width=1)
# Wooden bridges: thick planks over the river.
for bx,by in bridges:
    x,y=bx//2,by//2
    D.rectangle((x-60,y-21,x+60,y+21),fill='#604633')
    for t in range(-55,56,10):
        D.rectangle((x+t,y-17,x+t+8,y+17),fill='#b18452')
        D.line((x+t,y-17,x+t+8,y-17),fill='#e2b778',width=1)
    D.line((x-59,y-19,x+59,y-19),fill='#47362e',width=3)
    D.line((x-59,y+19,x+59,y+19),fill='#47362e',width=3)

# Custom ruins at the boss: rubble/monolith ring around perimeter.
for i in range(21):
    theta=2*math.pi*i/21
    x=int((3240+355*math.cos(theta))/2);y=int((1290+352*math.sin(theta))/2)
    if x<15 or x>PW-15 or y<15 or y>PH-15:continue
    s=R.randrange(8,15)
    D.polygon([(x-s,y+6),(x-s//2,y-s),(x+s//2,y-s-2),(x+s,y+5)],fill='#636579')
    D.line([(x-s//2,y-s),(x+s//2,y-s-2)],fill='#a0a4b8',width=2)

# PNG background at 2:1 sharp upscale for a hand-pixelled look.
img=img.resize((W,H),Image.Resampling.NEAREST)
img.save(OUT/'world.png',optimize=True)

# Geometries: collision centers read from the same masks used for artwork.
characters=[]
for ty in range(CH):
    row=[]
    for tx in range(CW):
        ix=min(PW-1,tx*TS//2+TS//4);iy=min(PH-1,ty*TS//2+TS//4)
        if a[iy,ix]:kind=6
        elif w[iy,ix] and not r[iy,ix]:kind=3
        elif c[iy,ix]:kind=4
        elif r[iy,ix]:kind=1
        else:kind=0
        row.append(kind)
    characters.append(row)

# Decor positions are deliberately off-grid; trunks affect only nearby tiles.
objects=[]
choices=['oak','pine','cherry','rock','bush','mushroom']
for ty in range(2,CH-2):
    for tx in range(2,CW-2):
        if characters[ty][tx]!=0:continue
        px=tx*TS+R.randrange(5,28);py=ty*TS+R.randrange(5,28)
        safe=math.hypot(px-710,py-1370)>300 and math.hypot(px-3240,py-1290)>475
        if not safe:continue
        # Forest pockets plus light scatter.
        forest= (math.hypot(px-600,py-480)<620 or math.hypot(px-1300,py-2000)<720 or math.hypot(px-2450,py-600)<650 or math.hypot(px-3000,py-2180)<600)
        chance=.22 if forest else .065
        if R.random()>chance:continue
        kind=R.choices(choices,[31,20,7,12,18,12])[0]
        # Tall trees are sparse, preserving combat visibility and paths.
        if kind in ('oak','pine','cherry'):
            occupied=False
            for obj in objects[-55:]:
                if obj['kind'] in ('oak','pine','cherry') and math.hypot(obj['x']-px,obj['y']-py)<78:occupied=True;break
            if occupied:continue
            for dx,dy in [(0,0),(-15,0),(15,0),(0,-10)]:
                cx=int((px+dx)//TS);cy=int((py+dy)//TS)
                if 0<=cx<CW and 0<=cy<CH and characters[cy][cx]!=0:occupied=True;break
            if occupied:continue
            characters[ty][tx]=5
        elif kind=='rock':
            characters[ty][tx]=5
        objects.append({'kind':kind,'x':px,'y':py})
# Specialized shrine props around boss, walls visually rich but not blocking exit.
for i in range(8):
    t=2*math.pi*i/8
    px=int(3240+390*math.cos(t));py=int(1290+360*math.sin(t))
    objects.append({'kind':'obelisk','x':px,'y':py})

with open(OUT/'world.json','w') as f:
    json.dump({'width':CW,'height':CH,'tileSize':32,'grid':characters,'objects':objects,'spawn':{'x':710,'y':1370},'boss':{'x':3240,'y':1290}},f,separators=(',',':'))

# Pixel art sprite design; all assets generated without third-party artwork.
outline='#252538'

def spr(w,h):return Image.new('RGBA',(w,h))
def poly(d,points,fill,stroke=outline,width=1):
    d.polygon(points,fill=fill)
    if stroke:d.line(points+[points[0]],fill=stroke,width=width,joint='curve')
def circ(d,box,fill,stroke=None,width=1):
    d.ellipse(box,fill=fill,outline=stroke,width=width)

def hero(direction,frame):
    I=spr(54,68);d=ImageDraw.Draw(I)
    walk=frame in (1,3);step=2 if frame==1 else -2 if frame==3 else 0
    # dramatic red cape silhouette
    poly(d,[(12,27),(42,27),(46,59),(33,64),(18,57),(9,62)],'#ae324e',outline,2)
    poly(d,[(15,31),(19,56),(28,60),(35,56),(41,34)],'#d64d60',None)
    # boots leg stride
    for sx,ss in [(17,step),(32,-step)]:
        d.rectangle((sx,48+ss,sx+8,60+ss),fill='#63482f',outline=outline,width=1)
        d.rectangle((sx-1,57+ss,sx+9,61+ss),fill='#916843')
        d.line((sx,49+ss,sx+8,49+ss),fill='#bd9872',width=2)
    # torso navy base & blue polished armor
    poly(d,[(14,29),(23,24),(35,24),(43,31),(40,49),(15,50),(12,37)],'#344a75',outline,2)
    poly(d,[(18,29),(24,27),(34,27),(39,32),(37,47),(17,47)],'#358ec0',None)
    d.polygon([(18,29),(24,27),(34,27),(38,32),(26,37)],fill='#5db4d2')
    d.line((17,44,39,44),fill='#f2c674',width=3)
    d.rectangle((25,43,30,47),fill='#ffd894',outline='#936d40')
    # upper arms & gloves
    d.rectangle((10,33,17,44),fill='#e5b789',outline=outline,width=1)
    d.rectangle((38,33,45,44),fill='#e5b789',outline=outline,width=1)
    d.rectangle((10,39,18,43),fill='#415d8b',outline=outline,width=1)
    d.rectangle((37,39,45,43),fill='#415d8b',outline=outline,width=1)
    if direction=='up':
        # head from back with fluffy auburn hair and cape neck
        circ(d,(17,8,39,33),'#95542e',outline,2)
        d.polygon([(18,14),(18,8),(27,5),(38,12),(36,27),(30,31),(22,26)],fill='#a65a2e')
        d.line([(17,18),(26,10),(34,14)],fill='#d78c46',width=3)
        d.line([(20,28),(34,29)],fill='#6b3b27',width=3)
    else:
        circ(d,(17,9,40,33),'#edbb8b',outline,2)
        d.ellipse((21,17,37,30),fill='#f6cf9f')
        # asymmetric windswept hair, highlights
        poly(d,[(16,20),(15,12),(23,5),(34,7),(41,13),(39,19),(32,15),(26,17),(21,14),(19,23)],'#8b4428',outline,2)
        d.line([(17,14),(23,9),(30,10),(35,14)],fill='#d08a41',width=3)
        d.line([(17,23),(20,18),(22,15)],fill='#cf8543',width=2)
        d.rectangle((24,23,26,25),fill='#24283b')
        if direction=='down':d.rectangle((34,23,36,25),fill='#24283b')
        if direction=='left':
            d.rectangle((23,23,25,25),fill='#25283a');d.rectangle((36,23,39,29),fill='#e4b48c')
        if direction=='right':d.rectangle((35,23,37,25),fill='#25283a')
        d.rectangle((29,29,31,30),fill='#b66b70')
    # gold and blue shield held in front
    shX=6 if direction!='left' else 33
    if direction!='up':
        poly(d,[(shX,35),(shX+9,33),(shX+14,37),(shX+12,51),(shX+7,55),(shX+1,51)],'#e6bc69',outline,2)
        poly(d,[(shX+3,37),(shX+9,36),(shX+12,39),(shX+10,50),(shX+7,52),(shX+3,49)],'#3279c1',None)
        d.polygon([(shX+6,40),(shX+9,42),(shX+6,46),(shX+4,43)],fill='#f0d98e')
    # sword pixel art angled outside body, animated arms swing
    if direction=='left':
        poly(d,[(10,39),(-3,35),(0,30),(13,34)],'#c5dce6',outline,1)
    elif direction=='up':
        poly(d,[(41,32),(45,8),(49,9),(45,36)],'#eaf4f6',outline,1)
    else:
        bladeX=43 + (2 if frame==2 else 0)
        poly(d,[(bladeX,40),(bladeX+9,13),(bladeX+13,14),(bladeX+5,43)],'#d6ebf0',outline,1)
        d.line((bladeX+3,38,bladeX+11,18),fill='white',width=1)
        d.line((bladeX-3,41,bladeX+9,45),fill='#e6bd72',width=3)
    return I

for direction in ['down','left','right','up']:
    pass
sh=spr(54*4,68*4)
for y,dir in enumerate(['down','left','right','up']):
    for f in range(4): sh.paste(hero(dir,f),(f*54,y*68))
sh.save(OUT/'hero.png')

def rat(frame):
    I=spr(58,46);d=ImageDraw.Draw(I);bob=1 if frame==1 else 0
    # rat shadow and long curved tail
    circ(d,(9,36,52,41),'#19232e66')
    d.line([(14,30),(6,34),(3,30),(5,25),(1,23)],fill=outline,width=4,joint='curve')
    d.line([(14,30),(6,34),(3,30),(5,25),(1,23)],fill='#d18f9b',width=2,joint='curve')
    # thick dusky brown fur with highlights
    circ(d,(11,18+bob,46,39+bob),'#4b454b',outline,2)
    circ(d,(14,18+bob,42,33+bob),'#71605a')
    d.polygon([(16,24),(23,20),(32,22),(27,26)],fill='#a58a77')
    # ears muzzle, glowing eye
    circ(d,(38,13+bob,49,28+bob),'#946e69',outline,2)
    circ(d,(29,10+bob,39,24+bob),'#8c6b64',outline,2)
    circ(d,(32,12+bob,37,18+bob),'#e5a6ac')
    circ(d,(35,18+bob,53,34+bob),'#746566',outline,2)
    circ(d,(44,24+bob,56,32+bob),'#c3a39a',None)
    d.rectangle((42,21+bob,45,23+bob),fill='#f05c6e')
    d.rectangle((52,27+bob,55,30+bob),fill='#e4b4ba')
    for x in [17,35,43]:d.line([(x,35+bob),(x+2,40+bob)],fill='#392f38',width=3)
    return I
sh=spr(58*4,46)
for f in range(4):sh.paste(rat(f),(f*58,0))
sh.save(OUT/'rat.png')

def bat(frame):
    I=spr(60,54);d=ImageDraw.Draw(I)
    wing=R.choice([0]) if False else frame%3
    lift=[-7,2,-4,1][frame]
    # wing scallops
    poly(d,[(27,25),(12,11+lift),(2,19+lift),(11,23+lift),(4,31+lift),(19,30+lift),(27,34)],'#534568',outline,2)
    poly(d,[(33,25),(48,11+lift),(58,19+lift),(49,23+lift),(56,31+lift),(41,30+lift),(33,34)],'#534568',outline,2)
    poly(d,[(23,25),(14,17+lift),(11,25+lift),(19,29),(26,31)],'#8f719e',None)
    poly(d,[(37,25),(46,17+lift),(49,25+lift),(41,29),(34,31)],'#8f719e',None)
    circ(d,(20,18,40,42),'#4a344f',outline,2)
    poly(d,[(21,24),(20,13),(28,20)],'#725b7a',outline,1)
    poly(d,[(39,24),(40,13),(32,20)],'#725b7a',outline,1)
    circ(d,(23,24,37,36),'#ad8db2')
    d.rectangle((25,27,28,30),fill='#f384a5');d.rectangle((33,27,36,30),fill='#f384a5')
    d.rectangle((29,32,33,34),fill='#f8dbdc')
    d.polygon([(29,34),(31,39),(33,34)],fill='#fdf5ec')
    return I
sh=spr(60*4,54)
for f in range(4):sh.paste(bat(f),(f*60,0))
sh.save(OUT/'bat.png')

def boss(frame):
    I=spr(120,142);d=ImageDraw.Draw(I)
    bob=[0,2,1,-1][frame]
    # floating black cloak and smoke fringes
    poly(d,[(33,84+bob),(87,84+bob),(100,135+bob),(87,137+bob),(79,130+bob),(67,140+bob),(58,133+bob),(45,141+bob),(30,135+bob),(20,140+bob)],'#30293b',outline,3)
    d.polygon([(40,90+bob),(81,89+bob),(90,129+bob),(66,126+bob),(53,131+bob),(35,129+bob)],fill='#46334a')
    # skeletal body and outstretched arms
    poly(d,[(38,66+bob),(17,82+bob),(6,100+bob),(12,108+bob),(31,91+bob),(42,88+bob)],'#a79982',outline,3)
    poly(d,[(82,66+bob),(102,80+bob),(113,97+bob),(108,106+bob),(91,90+bob),(77,87+bob)],'#a79982',outline,3)
    for sx in [13,105]:
        circ(d,(sx-6,98+bob,sx+4,108+bob),'#bcb099',outline,2)
        d.line([(sx-4,105+bob),(sx-8,112+bob)],fill='#bcb099',width=3)
    # broad shoulders, chest symbols
    poly(d,[(39,56+bob),(46,50+bob),(73,50+bob),(84,58+bob),(88,90+bob),(31,90+bob)],'#78665e',outline,3)
    d.line([(42,64+bob),(55,81+bob),(65,79+bob),(77,64+bob)],fill='#b5a089',width=4)
    d.line([(50,74+bob),(70,74+bob)],fill='#e4d5c2',width=2)
    # goat skull and hooked horns
    poly(d,[(38,53+bob),(32,24+bob),(10,16+bob),(1,35+bob),(14,29+bob),(28,42+bob),(37,62+bob)],'#77615c',outline,3)
    poly(d,[(82,53+bob),(88,24+bob),(110,16+bob),(119,35+bob),(106,29+bob),(92,42+bob),(83,62+bob)],'#77615c',outline,3)
    d.line([(10,26+bob),(21,25+bob),(32,43+bob)],fill='#b5a39d',width=4)
    d.line([(110,26+bob),(99,25+bob),(88,43+bob)],fill='#b5a39d',width=4)
    poly(d,[(34,53+bob),(43,35+bob),(76,35+bob),(86,53+bob),(75,76+bob),(66,88+bob),(59,92+bob),(52,85+bob),(44,72+bob)],'#b0a089',outline,3)
    d.polygon([(43,48+bob),(54,40+bob),(60,47+bob),(66,40+bob),(77,48+bob),(75,61+bob),(66,69+bob),(55,69+bob),(44,61+bob)],fill='#d3bea4')
    d.polygon([(50,63+bob),(70,63+bob),(66,83+bob),(60,89+bob),(53,82+bob)],fill='#66524b')
    d.rectangle((45,55+bob,53,61+bob),fill='#f33b57'); d.rectangle((67,55+bob,75,61+bob),fill='#f33b57')
    d.rectangle((47,56+bob,50,59+bob),fill='#fff0c8');d.rectangle((69,56+bob,72,59+bob),fill='#fff0c8')
    # smoldering red-orange flame hovering above skull
    poly(d,[(52,33+bob),(46,22+bob),(55,9+bob),(59,20+bob),(65,3+bob),(76,22+bob),(69,33+bob)],'#ff6e38',None)
    poly(d,[(56,31+bob),(55,22+bob),(61,14+bob),(65,24+bob),(70,31+bob)],'#ffd44c',None)
    # spell staff and violet glyph
    d.line([(99,99+bob),(109,37+bob)],fill='#3b2d3d',width=5)
    circ(d,(102,28+bob,116,42+bob),'#ac68d0','#352541',2)
    circ(d,(106,32+bob,112,38+bob),'#f6a2fd')
    return I
sh=spr(120*4,142)
for f in range(4):sh.paste(boss(f),(f*120,0))
sh.save(OUT/'baphomet.png')

def junior(frame):
    I=spr(58,66);d=ImageDraw.Draw(I);bob=frame%2
    # cute demonic child with wings and little legs
    poly(d,[(17,34),(5,28),(2,46),(19,48)],'#8a437a',outline,2)
    poly(d,[(41,34),(53,28),(56,46),(39,48)],'#8a437a',outline,2)
    circ(d,(14,20+bob,44,54+bob),'#f799bd',outline,2)
    d.polygon([(18,25+bob),(26,15+bob),(32,20+bob),(41,24+bob),(39,42+bob),(23,46+bob)],fill='#ffb5ce')
    poly(d,[(18,24+bob),(11,12+bob),(9,7+bob),(23,16+bob)],'#665471',outline,2)
    poly(d,[(40,24+bob),(47,12+bob),(49,7+bob),(35,16+bob)],'#665471',outline,2)
    d.polygon([(13,11+bob),(19,17+bob),(16,19+bob)],fill='#d6a2b7')
    d.polygon([(45,11+bob),(39,17+bob),(42,19+bob)],fill='#d6a2b7')
    d.polygon([(27,15+bob),(22,9+bob),(29,1+bob),(35,10+bob),(32,15+bob)],fill='#ff6a50')
    d.polygon([(27,14+bob),(27,8+bob),(31,5+bob),(32,14+bob)],fill='#ffd36b')
    d.rectangle((19,32+bob,25,37+bob),fill='#4f314f');d.rectangle((34,32+bob,40,37+bob),fill='#4f314f')
    d.rectangle((21,33+bob,23,35+bob),fill='#ffffff'); d.rectangle((36,33+bob,38,35+bob),fill='#ffffff')
    d.polygon([(26,43+bob),(29,47+bob),(32,43+bob)],fill='#df618a')
    d.rectangle((18,51+bob,25,57+bob),fill='#8c516d'); d.rectangle((33,51+bob,40,57+bob),fill='#8c516d')
    return I
sh=spr(58*4,66)
for f in range(4):sh.paste(junior(f),(f*58,0))
sh.save(OUT/'baphometjr.png')

# Nature scenery sprites. 1 pixel outline with hand-drawn irregular crowns.
def tree(name):
    # Silhouettes are irregular foliage clusters made of crisp pixel blocks,
    # not circular placeholder outlines. Their crowns are shaded in layers.
    local=random.Random(9113+sum(map(ord,name)))
    I=spr(104,132)
    d=ImageDraw.Draw(I)
    # soft 8-bit shadow with stepped edges
    d.polygon([(17,113),(25,108),(76,108),(88,114),(81,122),(25,122)],fill='#203c3255')
    # gnarled crooked trunk with branching structure
    poly(d,[(43,70),(57,64),(61,106),(66,117),(40,117),(46,106)],'#654630',outline,2)
    d.line([(49,84),(49,112)],fill='#ad7750',width=3)
    d.line([(49,87),(33,62)],fill='#563b2b',width=5)
    d.line([(53,84),(76,60)],fill='#563b2b',width=5)
    d.line([(41,112),(34,120)],fill='#4a3526',width=4)
    d.line([(62,112),(69,119)],fill='#4a3526',width=4)
    if name=='pine':
        # Jagged layered evergreen branches with asymmetrical stepped tips.
        layers=[(8,18,49),(31,28,73),(54,38,99)]
        for idx,(top,half,bottom) in enumerate(layers):
            col=['#244a42','#225847','#27604a'][idx]
            pts=[(52,top),(57,top+7),(59,top+12),(62,top+16),(52+half-12,bottom-12),
                 (52+half,bottom-5),(52+half-7,bottom),(52-half+7,bottom),
                 (52-half,bottom-5),(52-half+12,bottom-12),(44,top+17)]
            poly(d,pts,col,outline,2)
            d.line([(49,top+11),(40,bottom-13),(30,bottom-10)],fill='#56956e',width=3)
            d.line([(53,top+18),(58,bottom-15)],fill='#448c66',width=3)
            for k in range(24):
                yy=local.randint(top+15,bottom-4)
                xx=local.randint(max(11,52-half+6),min(94,52+half-6))
                if I.getpixel((xx,yy))[3] and local.random()<.6:
                    d.line([(xx,yy),(xx-3,yy+4)],fill=local.choice(['#347b59','#5e9b70','#77b77c','#1d423c']),width=2)
    else:
        colors=(['#7b466e','#b7608f','#d37fa9','#eea9c8','#ffcee1'] if name=='cherry' else
                ['#214c3e','#286748','#358255','#489d60','#71ba75'])
        crown=Image.new('L',(104,132));mc=ImageDraw.Draw(crown)
        clumps=[(24,56,16,15),(36,34,19,17),(60,30,19,20),(76,45,18,19),
                (85,62,12,15),(69,79,18,20),(44,79,22,20),(20,74,15,17),
                (49,15,12,11),(31,51,19,18),(61,54,22,21)]
        for cx,cy,rx,ry in clumps:
            offx=local.randint(-3,3);offy=local.randint(-3,3)
            cx+=offx;cy+=offy
            # irregular dimpled octagons, preserving a pixel style
            pts=[(cx-rx,cy-ry//3),(cx-rx+4,cy-ry+3),(cx-rx//3,cy-ry),
                 (cx+rx//3,cy-ry+2),(cx+rx-3,cy-ry//2),(cx+rx,cy+ry//3),
                 (cx+rx-6,cy+ry-2),(cx+rx//4,cy+ry),(cx-rx//2,cy+ry-3),
                 (cx-rx,cy+ry//3)]
            mc.polygon(pts,fill=255)
        # Solid outline around complete foliage silhouette.
        edge=crown.filter(ImageFilter.MaxFilter(5))
        I.paste(outline,(0,0),edge)
        I.paste(colors[0],(0,0),crown)
        d=ImageDraw.Draw(I)
        # Large overlapping angular color masses, all clipped to the crown.
        foliage=Image.new('RGBA',(104,132));fd=ImageDraw.Draw(foliage)
        for cx,cy,rx,ry in clumps:
            color=local.choice(colors[1:4]);cx+=local.randint(-2,2);cy+=local.randint(-3,3)
            vertices=[(cx-rx+6,cy-ry//2),(cx-rx//2,cy-ry+7),
                      (cx+rx//2,cy-ry+7),(cx+rx-4,cy-ry//3),
                      (cx+rx-6,cy+ry//3),(cx,cy+ry-6),(cx-rx+5,cy+ry//2)]
            fd.polygon(vertices,fill=color)
        I.alpha_composite(Image.composite(foliage,Image.new('RGBA',(104,132)),crown))
        d=ImageDraw.Draw(I)
        # Clustered four-pixel leaf glints; off-center lighting from upper-left.
        for k in range(270):
            xx=local.randint(12,90);yy=local.randint(8,94)
            if crown.getpixel((xx,yy))>0:
                if xx<45 and yy<56:col=colors[4] if local.random()<.36 else colors[3]
                elif xx>60 and yy>55:col=colors[1]
                else:col=local.choice(colors[1:4])
                if local.random()<.52:
                    d.rectangle((xx,yy,xx+local.randint(1,3),yy+local.randint(1,2)),fill=col)
                else:d.point((xx,yy),fill=col)
        if name=='cherry':
            for k in range(42):
                x=local.randint(20,82);y=local.randint(23,87)
                if crown.getpixel((x,y)):d.point((x,y),fill=local.choice(['#ffe9f0','#fae0e8','#fbbbd3']))
    return I
for name in ['oak','pine','cherry']:tree(name).save(OUT/(name+'.png'))

def makeprop(name):
    I=spr(64,54);d=ImageDraw.Draw(I)
    if name=='rock':
        poly(d,[(9,38),(12,20),(27,11),(46,15),(55,37),(47,48),(20,48)],'#5c7080',outline,2)
        poly(d,[(17,21),(27,14),(44,17),(35,27),(15,30)],'#94b0b7',None)
        d.line([(35,27),(43,44)],fill='#334b59',width=3)
    if name=='bush':
        circ(d,(9,30,54,48),'#224a3a',outline,2)
        circ(d,(6,22,38,45),'#3e8f59',outline,2)
        circ(d,(28,18,58,45),'#377c52',outline,2)
        circ(d,(17,16,47,41),'#56af65',outline,2)
        for bx,by in [(22,26),(36,29),(42,35)]:d.rectangle((bx,by,bx+3,by+3),fill='#81d579')
    if name=='mushroom':
        for x,y,s in [(17,26,1),(37,19,1.3)]:
            d.rectangle((x+4,y+10,x+9,y+25),fill='#dccba5',outline=outline,width=1)
            poly(d,[(x-1,y+11),(x+2,y+2),(x+11,y-1),(x+18,y+4),(x+20,y+11)],'#cb5576',outline,2)
            for dx,dy in [(5,6),(13,7),(9,3)]:d.rectangle((x+dx,y+dy,x+dx+2,y+dy+2),fill='#f7d7e1')
    if name=='obelisk':
        poly(d,[(18,48),(17,19),(29,3),(41,19),(42,48)],'#555164',outline,2)
        poly(d,[(21,42),(21,19),(29,8),(29,45)],'#79798e',None)
        d.line([(29,16),(29,34)],fill='#af6b9f',width=2)
        d.line([(24,26),(34,26)],fill='#af6b9f',width=2)
    return I
for name in ['rock','bush','mushroom','obelisk']:makeprop(name).save(OUT/(name+'.png'))

print('Art generated in',OUT)
print('object count',len(objects),'world image',round((OUT/'world.png').stat().st_size/1e6,2),'MB')
