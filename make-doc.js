const { Document, Packer, Paragraph, Table, TableRow, TableCell, TextRun, HeadingLevel, BorderStyle, WidthType, AlignmentType, ShadingType } = require('docx');
const fs = require('fs');

function h1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 150 },
  });
}

function p(text) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22 })],
    spacing: { after: 120 },
  });
}

function bold(text) {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 22 })],
    spacing: { after: 120 },
  });
}

function code(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Courier New', size: 18 })],
    spacing: { after: 60 },
    indent: { left: 400 },
    shading: { type: ShadingType.SOLID, color: 'F0F0F0' },
  });
}

function tableRow(label, value, isHeader = false) {
  return new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: isHeader, size: 20 })] })],
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: isHeader ? { type: ShadingType.SOLID, color: 'D9E1F2' } : undefined,
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: value, size: 20 })] })],
        width: { size: 70, type: WidthType.PERCENTAGE },
        shading: isHeader ? { type: ShadingType.SOLID, color: 'D9E1F2' } : undefined,
      }),
    ],
  });
}

const doc = new Document({
  sections: [{
    properties: {},
    children: [
      h1('德育護理健康學院圖書館 RWD 網站部署需求'),
      p('文件日期：2026 年 4 月'),
      p('聯絡人：圖書館'),

      h2('一、專案說明'),
      p('建立圖書館館藏查詢的手機／平板友善介面（RWD），作為原系統 collections.dyhu.edu.tw 的前端代理。使用者透過新網站查詢，後端伺服器再向原系統取得資料並回傳，不需修改原有 HyLib 系統。'),

      h2('二、伺服器最低需求'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          tableRow('項目', '需求', true),
          tableRow('作業系統', 'Linux（Ubuntu 20.04+ 建議）或 Windows Server'),
          tableRow('Node.js', '版本 18 以上'),
          tableRow('RAM', '512 MB 以上'),
          tableRow('硬碟', '100 MB 以上'),
          tableRow('網路位置', '必須在台灣境內（關鍵需求，詳見下方說明）'),
          tableRow('對外 Port', '開放任一 Port，建議 80 或 3000'),
        ],
      }),

      h2('三、關鍵需求說明'),
      bold('▎為何伺服器必須在台灣境內？'),
      p('原館藏系統 collections.dyhu.edu.tw 會封鎖海外 IP。本專案開發過程中曾嘗試部署至 Vercel（美國）及 Render（新加坡），均因原系統封鎖而無法取得資料，確認伺服器需位於台灣境內方可正常運作。'),

      bold('▎流量估計'),
      p('每次查詢約產生 2 次對原系統的 HTTP 請求，回應資料量約 100–500 KB／次。圖書館使用量不大，一般校園伺服器完全足夠。'),

      bold('▎資料庫需求'),
      p('本系統不需要資料庫，不儲存任何使用者資料，所有查詢資料來源均為原 HyLib 系統。'),

      h2('四、程式碼來源'),
      p('GitHub 儲存庫：https://github.com/pendastw/library-rwd'),
      p('（可設為 Private，資訊組 clone 後即可使用）'),

      h2('五、部署步驟（Linux）'),
      p('Step 1：安裝 Node.js（若尚未安裝）'),
      code('curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -'),
      code('sudo apt-get install -y nodejs'),
      p('Step 2：下載程式碼'),
      code('git clone https://github.com/pendastw/library-rwd.git'),
      code('cd library-rwd'),
      p('Step 3：安裝相依套件'),
      code('npm install --production'),
      p('Step 4：安裝 PM2（背景執行管理工具）'),
      code('npm install -g pm2'),
      p('Step 5：啟動服務'),
      code('pm2 start server.js --name library-rwd'),
      p('Step 6：設定開機自動啟動'),
      code('pm2 startup'),
      code('pm2 save'),

      h2('六、部署步驟（Windows Server）'),
      p('Step 1：安裝 Node.js'),
      p('至 https://nodejs.org 下載 LTS 版安裝檔並執行安裝。'),
      p('Step 2：下載程式碼（需先安裝 Git）'),
      code('git clone https://github.com/pendastw/library-rwd.git'),
      code('cd library-rwd'),
      p('Step 3：安裝相依套件'),
      code('npm install --production'),
      p('Step 4：安裝 PM2 並設定自動啟動'),
      code('npm install -g pm2 pm2-windows-startup'),
      code('pm2-startup install'),
      p('Step 5：啟動服務'),
      code('pm2 start server.js --name library-rwd'),
      code('pm2 save'),

      h2('七、驗證是否正常運作'),
      p('啟動後在瀏覽器輸入以下網址，若回傳 JSON 資料即表示部署成功：'),
      code('http://伺服器IP:3000/api/search?q=護理&field=FullText&page=1'),

      h2('八、日常維護'),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          tableRow('操作', '指令', true),
          tableRow('更新程式碼', 'git pull && pm2 restart library-rwd'),
          tableRow('查看執行狀態', 'pm2 status'),
          tableRow('查看錯誤日誌', 'pm2 logs library-rwd'),
          tableRow('停止服務', 'pm2 stop library-rwd'),
          tableRow('重新啟動', 'pm2 restart library-rwd'),
        ],
      }),

      new Paragraph({ text: '', spacing: { after: 200 } }),

      h2('九、程式碼更新流程'),
      p('日後圖書館若需修改網站內容（如調整介面、新增功能），修改完成後會推送至 GitHub。建議資訊組設定自動同步機制，讓伺服器在程式碼更新後自動套用，無需每次人工介入。'),

      bold('▎方式一：手動更新（最簡單）'),
      p('圖書館通知資訊組後，在伺服器執行以下指令即可完成更新：'),
      code('cd ~/library-rwd && git pull && pm2 restart library-rwd'),

      bold('▎方式二：排程自動更新（建議，每日自動同步）'),
      p('在伺服器設定 crontab，每日定時自動拉取最新程式碼：'),
      code('crontab -e'),
      p('加入以下排程（每日凌晨 3 點自動更新）：'),
      code('0 3 * * * cd ~/library-rwd && git pull && pm2 restart library-rwd >> ~/library-rwd-update.log 2>&1'),

      bold('▎方式三：GitHub Webhook 自動部署（最即時）'),
      p('設定 GitHub Webhook，每次程式碼推送後自動觸發伺服器更新，可達到即時同步效果。需要伺服器對外開放一個 Webhook 接收用的 Port，設定較複雜，可視需求評估。'),

      new Paragraph({ text: '', spacing: { after: 200 } }),
      p('如有技術問題請聯絡圖書館確認程式碼版本與設定。'),
    ],
  }],
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync('/Users/pendas/Desktop/圖書館RWD部署需求.docx', buffer);
  console.log('✅ 已產生：桌面/圖書館RWD部署需求.docx');
});
