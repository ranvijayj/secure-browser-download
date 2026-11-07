from PIL import Image, ImageDraw
def icon(size, path):
    S = 1024; im = Image.new("RGBA", (S, S), (0,0,0,0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([40,40,984,984], radius=220, fill=(34,66,199,255))          # blue tile
    d.rounded_rectangle([352,170,672,560], radius=160, outline=(255,255,255,255), width=78)  # shackle
    d.rectangle([300,420,724,470], fill=(34,66,199,255))                            # cut shackle bottom
    d.rounded_rectangle([250,430,774,870], radius=70, fill=(255,255,255,255))         # lock body
    # download arrow inside body
    c=(34,66,199,255); d.rectangle([482,500,542,700], fill=c); d.polygon([(402,660),(622,660),(512,780)], fill=c)
    d.rectangle([380,800,644,826], fill=c)
    im.resize((size,size), Image.LANCZOS).save(path)
for s in (16,32,48,128): icon(s, f"ext/icons/{s}.png")
icon(512, "assets/icon-512.png")
