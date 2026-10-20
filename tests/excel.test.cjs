const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
require('../excel.js');
const url = makeContactWorkbook([{name: 'Missing email', company: 'Ignored', emails: []}, {name: 'Whitespace', emails: [' ', '']}, { name: '=1+1', company: 'R&D <Company>', website: 'https://company.example/', linkedin: 'https://www.linkedin.com/in/jane-doe/', emails: ['jane@example.com', 'second@example.com'] }, { name: 'Zoë 王', company: '', emails: ['zoe@example.com'] }]);
const output = path.join(__dirname, 'artifacts'); fs.mkdirSync(output, { recursive: true });
const file = path.join(output, 'contacts-test.xlsx'); fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
execFileSync('python', ['-c', `import zipfile,xml.etree.ElementTree as E,sys
with zipfile.ZipFile(sys.argv[1]) as z:
 assert z.testzip() is None
 for name in z.namelist(): E.fromstring(z.read(name))
 sheet=E.fromstring(z.read('xl/worksheets/sheet1.xml'))
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 rows=sheet.findall('s:sheetData/s:row',ns)
 assert len(rows)==3
 assert rows[1][0].find('s:is/s:t',ns).text=='=1+1'
 assert rows[1][1].find('s:is/s:t',ns).text=='R&D <Company>'
 assert rows[2][0].find('s:is/s:t',ns).text=='Zoë 王'
 assert len(rows[1])==5
 assert [cell.find('s:is/s:t',ns).text for cell in rows[0]]==['Client name','Company name','Company website','Founder personal LinkedIn URL','Main email address']
 assert rows[1][2].find('s:is/s:t',ns).text=='https://company.example/'
 assert rows[1][3].find('s:is/s:t',ns).text=='https://www.linkedin.com/in/jane-doe/'
 assert rows[2][2].find('s:is/s:t',ns).text is None
 assert rows[2][3].find('s:is/s:t',ns).text is None
 assert rows[1][4].find('s:is/s:t',ns).text=='jane@example.com'+chr(10)+'second@example.com'
 assert rows[1].get('ht')=='32'
 assert sheet.find('s:autoFilter',ns).get('ref')=='A1:E3'
 styles=E.fromstring(z.read('xl/styles.xml'))
 assert styles.find('s:cellXfs',ns)[1].find('s:alignment',ns).get('wrapText')=='1'
 assert not sheet.findall('.//s:f',ns)
print('PASS XLSX ZIP, XML, Unicode, multiline email cells, excluded blank-email rows and formula-safe strings')`, file], { stdio: 'inherit' });
