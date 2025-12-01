import { NextResponse } from "next/server";
import { Document, Packer, Paragraph, TextRun } from "docx";

export async function POST(request: Request) {
  const { title, content, format = "docx" } = await request.json().catch(() => ({}));

  if (!title || !content) {
    return NextResponse.json({ error: "Title and content required" }, { status: 400 });
  }

  const stamp = new Date().toISOString().split("T")[0];
  const sanitizedTitle = title.replace(/\s+/g, "_");

  if (format === "txt") {
    const textContent = `${title}\n\n${content}`;
    const blob = new Blob([textContent], { type: "text/plain" });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    return new NextResponse(uint8Array, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="${sanitizedTitle}_${stamp}.txt"`
      }
    });
  }

  if (format === "pdf") {
    // For PDF, we'll generate it client-side using jsPDF
    // Return a flag to indicate client-side generation is needed
    return NextResponse.json({ 
      needsClientGeneration: true,
      title,
      content,
      filename: `${sanitizedTitle}_${stamp}.pdf`
    });
  }

  // Default: DOCX format
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
  const filename = `${sanitizedTitle}_${stamp}.docx`;

  const uint8Array = new Uint8Array(buffer);

  return new NextResponse(uint8Array, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}

