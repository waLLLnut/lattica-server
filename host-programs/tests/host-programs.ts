import * as anchor from "@coral-xyz/anchor";
import { Program, EventParser } from "@coral-xyz/anchor";
import { HostPrograms } from "../target/types/host_programs";
import { LendingDemo } from "../target/types/lending_demo";
import idl from "../target/idl/host_programs.json";
import { sha256 } from "@noble/hashes/sha256";
import { PublicKey } from "@solana/web3.js";
import { expect } from "chai";

/**
 * Rust의 `solana_sha256_hasher::hashv`와 동일한 기능을 구현합니다.
 * 여러 바이트 배열을 순차적으로 연결한 후 SHA256 해시를 계산합니다.
 * 
 * @param vals - 해시할 바이트 배열들의 배열
 * @returns 32바이트 SHA256 해시 (Uint8Array)
 */
function hashv(vals: Uint8Array[]): Uint8Array {
  const hasher = sha256.create();
  for (const val of vals) {
    hasher.update(val);
  }
  return hasher.digest();
}

/**
 * Rust의 derive_unary_handle과 동일한 로직으로 handle을 계산합니다.
 */
function deriveUnaryHandle(
  op: number,
  input: Uint8Array,
  programId: PublicKey
): Uint8Array {
  const HANDLE_DOMAIN_UNARY = new TextEncoder().encode("FHE16_UNARY_V1");
  const opByte = new Uint8Array([op]);
  const hash = hashv([
    HANDLE_DOMAIN_UNARY,
    programId.toBuffer(),
    opByte,
    input,
  ]);
  return hash;
}

/**
 * Rust의 derive_binary_handle과 동일한 로직으로 handle을 계산합니다.
 */
function deriveBinaryHandle(
  op: number,
  lhs: Uint8Array,
  rhs: Uint8Array,
  programId: PublicKey
): Uint8Array {
  const HANDLE_DOMAIN_BINARY = new TextEncoder().encode("FHE16_BINARY_V1");
  const opByte = new Uint8Array([op]);
  const hash = hashv([
    HANDLE_DOMAIN_BINARY,
    programId.toBuffer(),
    opByte,
    lhs,
    rhs,
  ]);
  return hash;
}

/**
 * Rust의 derive_ternary_handle과 동일한 로직으로 handle을 계산합니다.
 */
function deriveTernaryHandle(
  op: number,
  a: Uint8Array,
  b: Uint8Array,
  c: Uint8Array,
  programId: PublicKey
): Uint8Array {
  const HANDLE_DOMAIN_TERNARY = new TextEncoder().encode("FHE16_TERNARY_V1");
  const opByte = new Uint8Array([op]);
  const hash = hashv([
    HANDLE_DOMAIN_TERNARY,
    programId.toBuffer(),
    opByte,
    a,
    b,
    c,
  ]);
  return hash;
}

/**
 * IDL JSON에서 enum variant 순서를 찾아서 index를 계산합니다.
 * Borsh enum discriminant는 variant index이므로, IDL의 variants 배열에서 순서를 찾으면 됩니다.
 */
function norm(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); // _,- 제거 + 소문자
}

function enumDiscriminantFromIdl(
  idlJson: typeof idl,
  enumName: string,
  enumValue: Record<string, unknown>
): number {
  const variantKey = Object.keys(enumValue ?? {})[0];
  if (!variantKey) {
    throw new Error(`enumValue has no variant key`);
  }

  const t = (idlJson.types ?? []).find(
    (x: any) => norm(x.name) === norm(enumName)
  );
  if (!t || t.type?.kind !== "enum") {
    throw new Error(
      `Enum "${enumName}" not found in imported IDL. Available: ` +
        (idlJson.types ?? []).map((x: any) => x.name).join(", ")
    );
  }

  const idx = t.type.variants.findIndex(
    (v: any) => norm(v.name) === norm(variantKey)
  );
  if (idx === -1) {
    throw new Error(
      `Variant "${variantKey}" not in enum "${enumName}". Variants: ` +
        t.type.variants.map((v: any) => v.name).join(", ")
    );
  }
  return idx;
}

/**
 * 이벤트 데이터에서 PublicKey를 안전하게 추출
 */
function safeGetPublicKey(
  data: Record<string, unknown>,
  fieldName: string
): PublicKey {
  const value = data[fieldName];
  if (!value) {
    throw new Error(`Field ${fieldName} is undefined in event data`);
  }
  if (value instanceof PublicKey) {
    return value;
  }
  if (typeof value === "string") {
    return new PublicKey(value);
  }
  throw new Error(
    `Field ${fieldName} is not a valid PublicKey: ${typeof value}`
  );
}

/**
 * 이벤트 데이터에서 Uint8Array를 안전하게 추출
 * snake_case와 camelCase 필드 이름을 모두 확인합니다
 */
function safeGetUint8Array(
  data: Record<string, unknown>,
  fieldName: string
): Uint8Array {
  // snake_case와 camelCase 모두 확인
  const snakeCaseName = fieldName;
  const camelCaseName =
    fieldName.charAt(0).toLowerCase() +
    fieldName.slice(1).replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());

  const value =
    data[snakeCaseName] ||
    data[camelCaseName] ||
    (data as Record<string, unknown>)[fieldName];

  if (!value) {
    throw new Error(
      `Field ${fieldName} (${snakeCaseName}/${camelCaseName}) is undefined in event data`
    );
  }

  if (value instanceof Uint8Array) {
    return value;
  }

  if (Array.isArray(value)) {
    return Uint8Array.from(value);
  }

  throw new Error(
    `Field ${fieldName} is not a valid Uint8Array or array: ${typeof value}`
  );
}

/**
 * 트랜잭션에서 특정 이벤트를 찾아 반환
 */
async function getEvent(
  program: Program<HostPrograms>,
  provider: anchor.AnchorProvider,
  txSig: string,
  eventName: string
): Promise<{ name: string; data: Record<string, unknown> }> {
  await provider.connection.confirmTransaction(txSig, "confirmed");

  const tx = await provider.connection.getTransaction(txSig, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    throw new Error(`Transaction ${txSig} not found`);
  }

  const eventParser = new EventParser(program.programId, program.coder);
  for (const event of eventParser.parseLogs(tx.meta?.logMessages ?? [])) {
    const camelCaseName = eventName.charAt(0).toLowerCase() + eventName.slice(1);
    if (event.name === eventName || event.name === camelCaseName) {
      return event;
    }
  }

  throw new Error(`Event ${eventName} not found in transaction ${txSig}`);
}

/**
 * 이벤트의 필드들을 한 번에 검증
 */
function assertEventFields(
  event: { name: string; data: Record<string, unknown> },
  expected: {
    caller?: PublicKey;
    handle?: Uint8Array;
    client_tag?: Uint8Array;
    input_handle?: Uint8Array;
    lhs_handle?: Uint8Array;
    rhs_handle?: Uint8Array;
    a_handle?: Uint8Array;
    b_handle?: Uint8Array;
    c_handle?: Uint8Array;
    result_handle?: Uint8Array;
    op?: { op: Record<string, unknown>; enumType: "Fhe16UnaryOp" | "Fhe16BinaryOp" | "Fhe16TernaryOp" };
  },
  wallet: anchor.Wallet
): void {
  if (expected.caller !== undefined) {
    const caller = safeGetPublicKey(event.data, "caller");
    expect(caller.toString(), "caller가 wallet.publicKey와 일치하지 않습니다").to.equal(
      wallet.publicKey.toString()
    );
  }

  const handleFields = [
    "handle",
    "client_tag",
    "input_handle",
    "lhs_handle",
    "rhs_handle",
    "a_handle",
    "b_handle",
    "c_handle",
    "result_handle",
  ] as const;

  for (const field of handleFields) {
    const expectedValue = expected[field as keyof typeof expected] as
      | Uint8Array
      | undefined;
    if (expectedValue !== undefined) {
      const actualValue = safeGetUint8Array(event.data, field);
      expect(
        Buffer.from(actualValue),
        `${field}이 입력값과 바이트 단위로 일치하지 않습니다`
      ).to.deep.equal(Buffer.from(expectedValue));
    }
  }

  if (expected.op !== undefined) {
    if (!event.data.op) {
      throw new Error("op 필드가 이벤트 데이터에 없습니다");
    }
    const eventOp = event.data.op as Record<string, unknown>;
    const eventOpCode = enumDiscriminantFromIdl(idl, expected.op.enumType, eventOp);
    const expectedOpCode = enumDiscriminantFromIdl(idl, expected.op.enumType, expected.op.op);
    expect(
      eventOpCode,
      "이벤트의 op numeric code가 입력값과 일치하지 않습니다"
    ).to.equal(expectedOpCode);
  }
}

describe("host-programs", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // IDL 이름이 host_programs이므로 workspace에서 hostPrograms로 접근 (Anchor 자동 변환)
  const program = anchor.workspace.hostPrograms as Program<HostPrograms>;
  const wallet = provider.wallet as anchor.Wallet;

  it("Initialize program", async () => {
    await program.methods
      .initialize()
      .accounts({ program: program.programId })
      .rpc();
  });

  it("Register input handle and verify event", async () => {
    const handle = new Uint8Array(32);
    handle.fill(1);
    const clientTag = new Uint8Array(32);
    clientTag.fill(2);

    const tx = await program.methods
      .registerInputHandle(Array.from(handle), Array.from(clientTag))
      .accounts({ caller: wallet.publicKey })
      .rpc();

    const event = await getEvent(program, provider, tx, "InputHandleRegistered");
    assertEventFields(event, { caller: wallet.publicKey, handle, client_tag: clientTag }, wallet);
  });

  it("Request unary operation with hash verification", async () => {
    const inputHandle = new Uint8Array(32);
    inputHandle.fill(10);
    const op = { not: {} };

    const opNumericCode = enumDiscriminantFromIdl(idl, "Fhe16UnaryOp", op);
    const expectedResultHandle = deriveUnaryHandle(opNumericCode, inputHandle, program.programId);

    const tx = await program.methods
      .requestUnaryOp(op, Array.from(inputHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();

    const event = await getEvent(program, provider, tx, "Fhe16UnaryOpRequested");
    assertEventFields(
      event,
      {
        caller: wallet.publicKey,
        input_handle: inputHandle,
        result_handle: expectedResultHandle,
        op: { op, enumType: "Fhe16UnaryOp" },
      },
      wallet
    );
  });

  it("Request binary operation with hash verification", async () => {
    const lhsHandle = new Uint8Array(32);
    lhsHandle.fill(20);
    const rhsHandle = new Uint8Array(32);
    rhsHandle.fill(30);
    const op = { add: {} };

    const opNumericCode = enumDiscriminantFromIdl(idl, "Fhe16BinaryOp", op);
    const expectedResultHandle = deriveBinaryHandle(
      opNumericCode,
      lhsHandle,
      rhsHandle,
      program.programId
    );

    const tx = await program.methods
      .requestBinaryOp(op, Array.from(lhsHandle), Array.from(rhsHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();

    const event = await getEvent(program, provider, tx, "Fhe16BinaryOpRequested");
    assertEventFields(
      event,
      {
        caller: wallet.publicKey,
        lhs_handle: lhsHandle,
        rhs_handle: rhsHandle,
        result_handle: expectedResultHandle,
        op: { op, enumType: "Fhe16BinaryOp" },
      },
      wallet
    );
  });

  it("Request ternary operation with hash verification", async () => {
    const aHandle = new Uint8Array(32);
    aHandle.fill(40);
    const bHandle = new Uint8Array(32);
    bHandle.fill(50);
    const cHandle = new Uint8Array(32);
    cHandle.fill(60);
    const op = { add3: {} };

    const opNumericCode = enumDiscriminantFromIdl(idl, "Fhe16TernaryOp", op);
    const expectedResultHandle = deriveTernaryHandle(
      opNumericCode,
      aHandle,
      bHandle,
      cHandle,
      program.programId
    );

    const tx = await program.methods
      .requestTernaryOp(op, Array.from(aHandle), Array.from(bHandle), Array.from(cHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();

    const event = await getEvent(program, provider, tx, "Fhe16TernaryOpRequested");
    assertEventFields(
      event,
      {
        caller: wallet.publicKey,
        a_handle: aHandle,
        b_handle: bHandle,
        c_handle: cHandle,
        result_handle: expectedResultHandle,
        op: { op, enumType: "Fhe16TernaryOp" },
      },
      wallet
    );
  });

  it("Complete workflow: register -> unary -> binary -> ternary", async () => {
    const inputHandle = new Uint8Array(32);
    inputHandle.fill(100);
    const clientTag = new Uint8Array(32);
    clientTag.fill(200);

    const tx1 = await program.methods
      .registerInputHandle(Array.from(inputHandle), Array.from(clientTag))
      .accounts({ caller: wallet.publicKey })
      .rpc();
    const event1 = await getEvent(program, provider, tx1, "InputHandleRegistered");
    assertEventFields(event1, { handle: inputHandle, client_tag: clientTag }, wallet);

    const notOp = { not: {} };
    const notOpNumericCode = enumDiscriminantFromIdl(idl, "Fhe16UnaryOp", notOp);
    const expectedNotResultHandle = deriveUnaryHandle(
      notOpNumericCode,
      inputHandle,
      program.programId
    );

    const tx2 = await program.methods
      .requestUnaryOp(notOp, Array.from(inputHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();
    const event2 = await getEvent(program, provider, tx2, "Fhe16UnaryOpRequested");
    const notResultHandle = safeGetUint8Array(event2.data, "result_handle");
    expect(
      Buffer.from(notResultHandle),
      "result_handle이 TypeScript에서 계산한 값과 바이트 단위로 일치하지 않습니다"
    ).to.deep.equal(Buffer.from(expectedNotResultHandle));

    const addOp = { add: {} };
    const addOpNumericCode = enumDiscriminantFromIdl(idl, "Fhe16BinaryOp", addOp);
    const rhsHandle = new Uint8Array(32);
    rhsHandle.fill(300);
    const expectedAddResultHandle = deriveBinaryHandle(
      addOpNumericCode,
      notResultHandle,
      rhsHandle,
      program.programId
    );

    const tx3 = await program.methods
      .requestBinaryOp(addOp, Array.from(notResultHandle), Array.from(rhsHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();
    const event3 = await getEvent(program, provider, tx3, "Fhe16BinaryOpRequested");
    const addResultHandle = safeGetUint8Array(event3.data, "result_handle");
    expect(
      Buffer.from(addResultHandle),
      "result_handle이 TypeScript에서 계산한 값과 바이트 단위로 일치하지 않습니다"
    ).to.deep.equal(Buffer.from(expectedAddResultHandle));

    const add3Op = { add3: {} };
    const add3OpNumericCode = enumDiscriminantFromIdl(idl, "Fhe16TernaryOp", add3Op);
    const bHandle = new Uint8Array(32);
    bHandle.fill(400);
    const cHandle = new Uint8Array(32);
    cHandle.fill(500);
    const expectedAdd3ResultHandle = deriveTernaryHandle(
      add3OpNumericCode,
      addResultHandle,
      bHandle,
      cHandle,
      program.programId
    );

    const tx4 = await program.methods
      .requestTernaryOp(add3Op, Array.from(addResultHandle), Array.from(bHandle), Array.from(cHandle))
      .accounts({ caller: wallet.publicKey })
      .rpc();
    const event4 = await getEvent(program, provider, tx4, "Fhe16TernaryOpRequested");
    const add3ResultHandle = safeGetUint8Array(event4.data, "result_handle");
    expect(
      Buffer.from(add3ResultHandle),
      "result_handle이 TypeScript에서 계산한 값과 바이트 단위로 일치하지 않습니다"
    ).to.deep.equal(Buffer.from(expectedAdd3ResultHandle));
  });
});

describe("lending-demo", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const lendingProgram = anchor.workspace.LendingDemo as Program<LendingDemo>;
  const hostProgram = anchor.workspace.HostPrograms as Program<HostPrograms>;
  const wallet = provider.wallet as anchor.Wallet;

  // Rust enum 순서에 따른 OpCode 매핑
  // pub enum Fhe16BinaryOp { Add, Sub, Ge }
  const LENDING_BIN_OPS = {
    Add: 0,
    Sub: 1,
    Ge: 2,
  };
  // pub enum Fhe16TernaryOp { Select }
  const LENDING_TER_OPS = {
    Select: 0,
  };

  it("Initialize Lending Demo", async () => {
    await lendingProgram.methods.initialize().rpc();
  });

  it("Deposit: SOL + Amount -> Final Handle Verification", async () => {
    const solBalance = new Uint8Array(32);
    solBalance.fill(10);
    const depositAmount = new Uint8Array(32);
    depositAmount.fill(5);

    const expectedFinalHandle = deriveBinaryHandle(
      LENDING_BIN_OPS.Add,
      solBalance,
      depositAmount,
      hostProgram.programId 
    );

    const tx = await lendingProgram.methods
      .deposit(Array.from(solBalance), Array.from(depositAmount))
      .accounts({
        caller: wallet.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");
    const txInfo = await provider.connection.getTransaction(tx, { 
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    
    if (!txInfo) {
      throw new Error(`Transaction ${tx} not found`);
    }
    
    const eventParser = new EventParser(lendingProgram.programId, lendingProgram.coder);
    let eventFound = false;
    const allEvents: string[] = [];
    
    for (const event of eventParser.parseLogs(txInfo.meta?.logMessages ?? [])) {
      allEvents.push(event.name);
      const camelCaseName = "depositCompleted";
      if (event.name === "DepositCompleted" || event.name === camelCaseName) {
        eventFound = true;
        const finalHandle = safeGetUint8Array(event.data, "final_handle");
        
        expect(Buffer.from(finalHandle)).to.deep.equal(
          Buffer.from(expectedFinalHandle), 
          "Deposit 결과 핸들이 예상값과 다릅니다."
        );
        break;
      }
    }
    
    if (!eventFound) {
      void console.log(`Available events: ${allEvents.join(", ")}`);
    }
    
    expect(eventFound, `DepositCompleted event not found. Available events: ${allEvents.join(", ")}`).to.be.true;
  });

  it("Withdraw: Chained Operations (GE -> SUB -> SELECT)", async () => {
    const usdcBalance = new Uint8Array(32);
    usdcBalance.fill(100);
    const withdrawAmount = new Uint8Array(32);
    withdrawAmount.fill(30);

    const expectedGeHandle = deriveBinaryHandle(
      LENDING_BIN_OPS.Ge,
      usdcBalance,
      withdrawAmount,
      hostProgram.programId
    );

    const expectedSubHandle = deriveBinaryHandle(
      LENDING_BIN_OPS.Sub,
      usdcBalance,
      withdrawAmount,
      hostProgram.programId
    );

    const expectedFinalHandle = deriveTernaryHandle(
      LENDING_TER_OPS.Select,
      expectedGeHandle,
      expectedSubHandle,
      usdcBalance,
      hostProgram.programId
    );

    const tx = await lendingProgram.methods
      .withdraw(Array.from(usdcBalance), Array.from(withdrawAmount))
      .accounts({
        caller: wallet.publicKey,
      })
      .rpc();

    await provider.connection.confirmTransaction(tx, "confirmed");
    const txInfo = await provider.connection.getTransaction(tx, { 
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!txInfo) {
      throw new Error(`Transaction ${tx} not found`);
    }

    const eventParser = new EventParser(lendingProgram.programId, lendingProgram.coder);
    let eventFound = false;
    const allEvents: string[] = [];
    
    for (const event of eventParser.parseLogs(txInfo.meta?.logMessages ?? [])) {
      allEvents.push(event.name);
      const camelCaseName = "withdrawCompleted";
      if (event.name === "WithdrawCompleted" || event.name === camelCaseName) {
        eventFound = true;
        
        const geResult = safeGetUint8Array(event.data, "ge_result_handle");
        const subResult = safeGetUint8Array(event.data, "sub_result_handle");
        const finalResult = safeGetUint8Array(event.data, "final_handle");

        expect(Buffer.from(geResult)).to.deep.equal(Buffer.from(expectedGeHandle), "GE Handle Mismatch");
        expect(Buffer.from(subResult)).to.deep.equal(Buffer.from(expectedSubHandle), "SUB Handle Mismatch");
        expect(Buffer.from(finalResult)).to.deep.equal(Buffer.from(expectedFinalHandle), "SELECT (Final) Handle Mismatch");
        break;
      }
    }
    
    if (!eventFound) {
      void console.log(`Available events: ${allEvents.join(", ")}`);
    }
    
    expect(eventFound, `WithdrawCompleted event not found. Available events: ${allEvents.join(", ")}`).to.be.true;
  });
});
