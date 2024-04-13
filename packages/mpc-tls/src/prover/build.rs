use std::io::Result;
use protobuf_zmq_rust_generator::ZmqServerGenerator;
use pathsearch::find_executable_in_path;

macro_rules! p {
	($($tokens: tt)*) => {
			println!("cargo:warning={}", format!($($tokens)*))
	}
}

fn main() -> Result<()> {
		if let Some(exe) = find_executable_in_path("protoc") {
			let path_to_exe = exe.display().to_string();
			p!("Found protoc compiler at {}", path_to_exe);
			std::env::set_var("PROTOC", path_to_exe);
			prost_build::Config::new()
					.out_dir("src/message/")
					.service_generator(Box::new(ZmqServerGenerator {}))
					.compile_protos(&["prover.proto"], &["proto/"])?;

			} else {
				p!("Cannot find protoc compiler on operating system. Please install protoc");
			}

		Ok(())
}
