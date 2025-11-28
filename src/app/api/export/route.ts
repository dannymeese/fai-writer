import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

export async function POST(request: Request) {
  const { title, content } = await request.json().catch(() => ({}));

  if (!title || !content) {
    return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  }

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: title,
                bold: true,
                size: 32
              })
            ],
            spacing: { after: 200 }
          }),
          ...content.split("\n").map(
            (line: string) =>
              new Paragraph({
                children: [new TextRun({ text: line })],
                spacing: { after: 120 }
              })
          )
        ]
      }
    ]
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${title.replace(/\s+/g, "_")}_${Date.now()}.docx`;
  const bytes = new Uint8Array(buffer);

  return new NextResponse(bytes, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

