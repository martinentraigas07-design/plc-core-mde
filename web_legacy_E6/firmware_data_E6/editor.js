var editor;

window.onload = function ()
{

  const container = document.getElementById("editor");

  editor = new Drawflow(container);

  editor.start();
  loadProgram();

};
function loadProgram()
{
    fetch("/load")
    .then(r => r.json())
    .then(data =>
    {
        if (data.drawflow)
        {
            editor.import(data);
        }
    });
}
function addInput1()
{
    editor.addNode(
        'input1',
        0,
        1,
        100,
        100,
        'input1',
        {},
        '<div>IN1</div>'
    );
}

function addInput2()
{
    editor.addNode(
        'input2',
        0,
        1,
        100,
        100,
        'input2',
        {},
        '<div>IN2</div>'
    );
}

function addOutput1()
{
    editor.addNode(
        'output1',
        1,
        0,
        100,
        100,
        'output1',
        {},
        '<div>OUT1</div>'
    );
}

function addOutput2()
{
    editor.addNode(
        'output2',
        1,
        0,
        100,
        100,
        'output2',
        {},
        '<div>OUT2</div>'
    );
}

function addOutput3()
{
    editor.addNode(
        'output3',
        1,
        0,
        100,
        100,
        'output3',
        {},
        '<div>OUT3</div>'
    );
}

function addOutput4()
{
    editor.addNode(
        'output4',
        1,
        0,
        100,
        100,
        'output4',
        {},
        '<div>OUT4</div>'
    );
}

function addAnalog1()
{
    editor.addNode(
        'analog1',
        0,
        1,
        100,
        100,
        'analog1',
        {},
        '<div>AI1</div>'
    );
}
function addCmp()
{
    var html =
    `
    <div style="font-size:12px">

        CMP<br>

        <select df-op style="width:50px">
            <option value=">">></option>
            <option value="<"><</option>
            <option value="==">==</option>
            <option value=">=">>=</option>
            <option value="<="><=</option>
        </select>

        <input type="number"
               df-value
               value="1000"
               style="width:60px">

    </div>
    `;

    editor.addNode(
        'cmp',
        1,
        1,
        100,
        100,
        'cmp',
        {
            value:1000,
            op:">"
        },
        html
    );
}
function addPWM()
{
    var html =
    `
    <div>
        PWM<br>

        OUT:
        <select df-out>
            <option value="0">1</option>
            <option value="1">2</option>
            <option value="2">3</option>
            <option value="3">4</option>
        </select>

        <input type="number"
               df-value
               value="1000"
               style="width:60px">
    </div>
    `;

    editor.addNode(
        'pwm',
        1,
        0,
        100,
        100,
        'pwm',
        {
            out:0,
            value:1000
        },
        html
    );
}
function addAND()
{
    editor.addNode(
        'and',
        2,
        1,
        100,
        100,
        'and',
        {},
        '<div>AND</div>'
    );
}

function addOR()
{
    editor.addNode(
        'or',
        2,
        1,
        100,
        100,
        'or',
        {},
        '<div>OR</div>'
    );
}

function addNOT()
{
    editor.addNode(
        'not',
        1,
        1,
        100,
        100,
        'not',
        {},
        '<div>NOT</div>'
    );
}
function addTON()
{
    var html =
    `
    <div>
        TON<br>
        <input type="number"
               df-time
               value="1000"
               style="width:60px"> ms
    </div>
    `;

    editor.addNode(
        'ton',
        1,
        1,
        100,
        100,
        'ton',
        { time:1000 },
        html
    );
}

function addTOF()
{
    var html =
    `
    <div>
        TOF<br>
        <input type="number"
               df-time
               value="1000"
               style="width:60px"> ms
    </div>
    `;

    editor.addNode(
        'tof',
        1,
        1,
        100,
        100,
        'tof',
        { time:1000 },
        html
    );
}

function addTP()
{
    var html =
    `
    <div>
        TP<br>
        <input type="number"
               df-time
               value="500"
               style="width:60px"> ms
    </div>
    `;

    editor.addNode(
        'tp',
        1,
        1,
        100,
        100,
        'tp',
        { time:500 },
        html
    );
}
function addXOR()
{
    editor.addNode(
        'xor', 2, 1, 100, 100, 'xor', {},
        '<div class="title-box">XOR</div>'
    );
}

function addRTrig() {
    editor.addNode('r_trig',1,1,100,100,'r_trig',{},
        '<div class="title-box">R_TRIG</div><div style="font-size:9px;color:#aaa">Flanco ↑</div>');
}
function addFTrig() {
    editor.addNode('f_trig',1,1,100,100,'f_trig',{},
        '<div class="title-box">F_TRIG</div><div style="font-size:9px;color:#aaa">Flanco ↓</div>');
}
function addSR() {
    editor.addNode('sr',2,1,100,100,'sr',{},
        '<div class="title-box">SR</div><div style="font-size:9px;color:#aaa">S dom.</div>');
}
function addRS() {
    editor.addNode('rs',2,1,100,100,'rs',{},
        '<div class="title-box">RS</div><div style="font-size:9px;color:#aaa">R dom.</div>');
}
function addCTU() {
    var html = `<div><div class="title-box">CTU</div>
        PV:<input type="number" df-value value="10" style="width:50px">
    </div>`;
    editor.addNode('ctu',2,1,100,100,'ctu',{value:10},html);
}
function addCTD() {
    var html = `<div><div class="title-box">CTD</div>
        PV:<input type="number" df-value value="10" style="width:50px">
    </div>`;
    editor.addNode('ctd',2,1,100,100,'ctd',{value:10},html);
}
function addScale() {
    var html = `<div style="font-size:10px"><div class="title-box">SCALE</div>
        in: <input type="number" df-inMin value="0" style="width:40px">-<input type="number" df-inMax value="4095" style="width:45px"><br>
        out:<input type="number" df-outMin value="0" style="width:40px">-<input type="number" df-outMax value="100" style="width:45px">
    </div>`;
    editor.addNode('scale',1,1,100,100,'scale',{inMin:0,inMax:4095,outMin:0,outMax:100},html);
}
function addBlink() {
    var html = `<div><div class="title-box">BLINK</div>
        T:<input type="number" df-time value="500" style="width:55px"> ms
    </div>`;
    editor.addNode('blink',1,1,100,100,'blink',{time:500},html);
}
